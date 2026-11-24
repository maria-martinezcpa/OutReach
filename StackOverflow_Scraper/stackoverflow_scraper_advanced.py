import requests
import sqlite3
import time
import json
from datetime import datetime

# Configuration
API_KEY = "rl_XVXhbYgKvvHfDPC4kQNXQHjpj"
BASE_URL = "https://api.stackexchange.com/2.3"
DATABASE = "stackoverflow_advanced.db"

class StackOverflowScraper:
    def __init__(self, api_key):
        self.api_key = api_key
        self.session = requests.Session()
        self.init_database()
        self.users_found = 0

    def init_database(self):
        """Create SQLite database if it doesn't exist"""
        conn = sqlite3.connect(DATABASE)
        cursor = conn.cursor()

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER PRIMARY KEY,
                username TEXT,
                reputation INTEGER,
                location TEXT,
                website TEXT,
                github_url TEXT,
                profile_url TEXT,
                created_at TEXT,
                scraped_at TEXT
            )
        ''')

        conn.commit()
        conn.close()
        print(f"✅ Database initialized: {DATABASE}")

    def save_user(self, user_data):
        """Save user to database"""
        conn = sqlite3.connect(DATABASE)
        cursor = conn.cursor()

        try:
            cursor.execute('''
                INSERT OR REPLACE INTO users
                (user_id, username, reputation, location, website, github_url, profile_url, created_at, scraped_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                user_data['user_id'],
                user_data['display_name'],
                user_data['reputation'],
                user_data.get('location', ''),
                user_data.get('website', ''),
                user_data.get('github_url', ''),
                user_data.get('link', ''),
                user_data.get('creation_date', ''),
                datetime.now().isoformat()
            ))
            conn.commit()
            self.users_found += 1
        except Exception as e:
            print(f"❌ Error saving user: {e}")
        finally:
            conn.close()

    def extract_github_url(self, website_url):
        """Extract GitHub URL from website field"""
        if not website_url:
            return None

        if "github.com" in website_url.lower():
            url = website_url.lower()
            if not url.startswith("http"):
                url = "https://" + url
            return url
        return None

    def location_matches(self, location, location_filter):
        """Check if location matches filter"""
        if not location_filter:
            return True

        location_lower = location.lower() if location else ""

        for keyword in location_filter:
            if keyword.lower() in location_lower:
                return True
        return False

    def has_github(self, website_url):
        """Check if user has GitHub URL"""
        return self.extract_github_url(website_url) is not None

    def fetch_users(self, filters):
        """
        Fetch users with customizable filters

        filters = {
            'tags': ['javascript', 'python'],  # List of tags to search
            'min_reputation': 100,              # Minimum reputation
            'max_reputation': 50000,            # Maximum reputation (optional)
            'locations': ['USA', 'California'], # Location keywords to include
            'exclude_locations': [],            # Location keywords to exclude
            'has_github': True,                 # Only users with GitHub
            'max_pages': 20                     # Max pages to search per tag
        }
        """

        tags = filters.get('tags', ['javascript', 'python', 'java', 'react'])
        min_reputation = filters.get('min_reputation', 50)
        max_reputation = filters.get('max_reputation', None)
        locations = filters.get('locations', [])
        exclude_locations = filters.get('exclude_locations', [])
        has_github = filters.get('has_github', False)
        max_pages = filters.get('max_pages', 20)

        print("=" * 70)
        print("Stack Overflow User Scraper - Advanced Filters")
        print("=" * 70)
        print(f"Tags: {', '.join(tags)}")
        print(f"Reputation: {min_reputation}" + (f" - {max_reputation}" if max_reputation else "+"))
        print(f"Locations to include: {locations if locations else 'All'}")
        print(f"Locations to exclude: {exclude_locations if exclude_locations else 'None'}")
        print(f"Must have GitHub: {has_github}")
        print("=" * 70)

        for tag in tags:
            self.fetch_users_by_tag(tag, min_reputation, max_reputation, locations, exclude_locations, has_github, max_pages)

        print(f"\n✅ Scraping complete! Total users found: {self.users_found}")
        self.export_results(has_github)

    def fetch_users_by_tag(self, tag, min_rep, max_rep, locations, exclude_locations, has_github, max_pages):
        """Fetch users by tag with filters"""
        page = 1
        has_more = True
        users_in_tag = 0

        print(f"\n🔍 Searching tag: {tag}")

        while has_more and page <= max_pages:
            try:
                params = {
                    'order': 'desc',
                    'sort': 'reputation',
                    'tagged': tag,
                    'site': 'stackoverflow',
                    'key': self.api_key,
                    'pagesize': 100,
                    'page': page
                }

                response = self.session.get(f"{BASE_URL}/users", params=params)
                response.raise_for_status()

                data = response.json()

                if 'items' not in data or not data['items']:
                    break

                for user in data['items']:
                    # Reputation filter
                    rep = user['reputation']
                    if rep < min_rep:
                        continue
                    if max_rep and rep > max_rep:
                        continue

                    # Location filter
                    location = user.get('location', '')

                    # Exclude locations
                    if exclude_locations and any(exc.lower() in location.lower() for exc in exclude_locations):
                        continue

                    # Include locations
                    if locations and not self.location_matches(location, locations):
                        continue

                    # GitHub filter
                    website = user.get('website_url', '')
                    github_url = self.extract_github_url(website)

                    if has_github and not github_url:
                        continue

                    user_data = {
                        'user_id': user['user_id'],
                        'display_name': user['display_name'],
                        'reputation': rep,
                        'location': location,
                        'website': website,
                        'github_url': github_url,
                        'link': user.get('link', ''),
                        'creation_date': datetime.fromtimestamp(user['creation_date']).isoformat()
                    }

                    self.save_user(user_data)
                    users_in_tag += 1

                    if github_url:
                        print(f"  ✓ {user['display_name']} ({location}) - {github_url}")

                has_more = data.get('has_more', False)
                page += 1
                time.sleep(0.5)

            except Exception as e:
                print(f"❌ Error on page {page}: {e}")
                time.sleep(2)
                continue

        print(f"  📊 Found {users_in_tag} users")

    def export_results(self, github_only=True):
        """Export results to JSON and CSV"""
        conn = sqlite3.connect(DATABASE)
        cursor = conn.cursor()

        if github_only:
            cursor.execute('''
                SELECT user_id, username, reputation, location, github_url, profile_url
                FROM users WHERE github_url IS NOT NULL
                ORDER BY reputation DESC
            ''')
        else:
            cursor.execute('''
                SELECT user_id, username, reputation, location, github_url, profile_url
                FROM users
                ORDER BY reputation DESC
            ''')

        rows = cursor.fetchall()

        users = []
        for row in rows:
            users.append({
                'user_id': row[0],
                'username': row[1],
                'reputation': row[2],
                'location': row[3],
                'github_url': row[4],
                'profile_url': row[5]
            })

        # JSON export
        json_file = 'stackoverflow_results.json'
        with open(json_file, 'w') as f:
            json.dump(users, f, indent=2)

        # CSV export
        csv_file = 'stackoverflow_results.csv'
        with open(csv_file, 'w') as f:
            f.write("Username,Reputation,Location,GitHub URL,Profile URL\n")
            for user in users:
                github = user["github_url"] if user["github_url"] else ""
                f.write(f'{user["username"]},{user["reputation"]},"{user["location"]}",{github},{user["profile_url"]}\n')

        print(f"\n📄 Exported {len(users)} results")
        print(f"   - {json_file}")
        print(f"   - {csv_file}")

        # Print top results
        print(f"\n🏆 Top 15 Results:\n")
        for i, user in enumerate(users[:15], 1):
            print(f"{i:2}. {user['username']:25} (Rep: {user['reputation']:6}) - {user['location']}")
            if user['github_url']:
                print(f"    {user['github_url']}")

        conn.close()

# USAGE EXAMPLES
if __name__ == "__main__":
    scraper = StackOverflowScraper(API_KEY)

    # EXAMPLE 1: US developers with GitHub (all tech tags)
    print("\n📌 EXAMPLE 1: US Developers with GitHub\n")
    filters_us = {
        'tags': ['javascript', 'python', 'java', 'react', 'nodejs'],
        'min_reputation': 100,
        'locations': ['USA', 'US', 'California', 'New York', 'Texas', 'Washington'],
        'has_github': True,
        'max_pages': 10
    }
    scraper.fetch_users(filters_us)

    # EXAMPLE 2: High reputation Python developers (worldwide)
    # Uncomment to use:
    """
    print("\n📌 EXAMPLE 2: Python Experts (Worldwide)\n")
    filters_python = {
        'tags': ['python'],
        'min_reputation': 5000,
        'has_github': True,
        'max_pages': 5
    }
    scraper.fetch_users(filters_python)
    """

    # EXAMPLE 3: Rust developers excluding EU
    # Uncomment to use:
    """
    print("\n📌 EXAMPLE 3: Rust Developers (Non-EU)\n")
    filters_rust = {
        'tags': ['rust'],
        'min_reputation': 100,
        'exclude_locations': ['Germany', 'UK', 'France', 'Sweden', 'Netherlands', 'India', 'Europe'],
        'has_github': True,
        'max_pages': 10
    }
    scraper.fetch_users(filters_rust)
    """
