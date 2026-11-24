import requests
import sqlite3
import time
import json
from datetime import datetime

# Configuration
API_KEY = "rl_XVXhbYgKvvHfDPC4kQNXQHjpj"
BASE_URL = "https://api.stackexchange.com/2.3"
DATABASE = "stackoverflow_us_max.db"

class StackOverflowUSMaxScraper:
    def __init__(self, api_key):
        self.api_key = api_key
        self.session = requests.Session()
        self.init_database()
        self.users_found = 0
        self.github_users = 0
        self.us_users = 0

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

    def is_us_location(self, location):
        """Check if location is in the United States"""
        if not location:
            return False

        us_keywords = [
            'usa', 'us ', ' us', 'united states', 'america',
            'california', 'new york', 'texas', 'florida', 'washington',
            'chicago', 'boston', 'seattle', 'san francisco', 'los angeles',
            'new jersey', 'pennsylvania', 'ohio', 'virginia', 'arizona',
            'north carolina', 'south carolina', 'colorado', 'minnesota',
            'ca,', 'ny,', 'tx,', 'fl,', 'wa,', 'ma,', 'il,', 'az,', 'co,',
            ', ca', ', ny', ', tx', ', fl', ', wa', ', ma', ', il', ', az', ', co',
            'denver', 'miami', 'atlanta', 'austin', 'houston', 'dallas',
            'phoenix', 'philadelphia', 'portland', 'vegas', 'vegas, nevada'
        ]

        location_lower = location.lower().strip()
        return any(keyword in location_lower for keyword in us_keywords)

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

            if user_data.get('github_url'):
                self.github_users += 1
                self.us_users += 1
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

    def fetch_users_by_tag(self, tag, min_reputation=50, max_pages=30):
        """Fetch US users by tag - MAXIMUM USERS"""
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
                    if user['reputation'] < min_reputation:
                        continue

                    location = user.get('location', '')

                    # ONLY US USERS
                    if not self.is_us_location(location):
                        continue

                    website = user.get('website_url', '')
                    github_url = self.extract_github_url(website)

                    # ONLY IF HAS GITHUB
                    if not github_url:
                        continue

                    user_data = {
                        'user_id': user['user_id'],
                        'display_name': user['display_name'],
                        'reputation': user['reputation'],
                        'location': location,
                        'website': website,
                        'github_url': github_url,
                        'link': user.get('link', ''),
                        'creation_date': datetime.fromtimestamp(user['creation_date']).isoformat()
                    }

                    self.save_user(user_data)
                    users_in_tag += 1

                    print(f"  ✓ {user['display_name']} ({location}) - {github_url}")

                has_more = data.get('has_more', False)
                page += 1

                # Rate limiting
                time.sleep(0.3)

            except Exception as e:
                print(f"❌ Error on page {page}: {e}")
                time.sleep(2)
                continue

        print(f"  📊 Found {users_in_tag} US users in tag: {tag}")

    def run(self):
        """Run the scraper to find MAXIMUM US users with GitHub"""
        print("=" * 80)
        print("STACK OVERFLOW - MAXIMUM US DEVELOPERS FINDER")
        print("=" * 80)
        print("Searching: ALL PROGRAMMING LANGUAGES")
        print("Filter: US Location ONLY")
        print("Filter: Must have GitHub")
        print("Filter: Reputation >= 50")
        print("=" * 80)

        # Search all major programming languages
        tags = [
            'javascript', 'python', 'java', 'react', 'nodejs',
            'typescript', 'csharp', 'php', 'cpp', 'golang',
            'rust', 'kotlin', 'swift', 'ruby', 'scala',
            'r', 'matlab', 'perl', 'groovy', 'haskell',
            'clojure', 'erlang', 'elixir', 'julia', 'lua',
            'dart', 'coffeescript', 'objective-c', 'assembly',
            'bash', 'docker', 'kubernetes', 'aws', 'azure'
        ]

        for tag in tags:
            self.fetch_users_by_tag(tag, min_reputation=50, max_pages=30)

        print("\n" + "=" * 80)
        print(f"✅ SCRAPING COMPLETE!")
        print(f"📊 Total users found: {self.users_found}")
        print(f"🇺🇸 US users with GitHub: {self.us_users}")
        print(f"💾 Database: {DATABASE}")
        print("=" * 80)

        self.export_results()

    def export_results(self):
        """Export results to multiple formats"""
        conn = sqlite3.connect(DATABASE)
        cursor = conn.cursor()

        # Get all US users with GitHub
        cursor.execute('''
            SELECT user_id, username, reputation, location, github_url, profile_url
            FROM users WHERE github_url IS NOT NULL
            ORDER BY reputation DESC
        ''')

        rows = cursor.fetchall()

        users_with_github = []
        for row in rows:
            users_with_github.append({
                'user_id': row[0],
                'username': row[1],
                'reputation': row[2],
                'location': row[3],
                'github_url': row[4],
                'profile_url': row[5]
            })

        # Export JUST GITHUB LINKS to github_links_us.txt
        with open('github_links_us.txt', 'w') as f:
            for user in users_with_github:
                f.write(user['github_url'] + '\n')

        # Export to JSON
        with open('stackoverflow_us_results.json', 'w') as f:
            json.dump(users_with_github, f, indent=2)

        # Export to CSV
        with open('stackoverflow_us_results.csv', 'w') as f:
            f.write("Username,Reputation,Location,GitHub URL,Profile URL\n")
            for user in users_with_github:
                f.write(f'{user["username"]},{user["reputation"]},"{user["location"]}",{user["github_url"]},{user["profile_url"]}\n')

        print(f"\n📄 EXPORTED {len(users_with_github)} US Developer GitHub Links!")
        print(f"   📝 github_links_us.txt - Just the links!")
        print(f"   📊 stackoverflow_us_results.csv")
        print(f"   📋 stackoverflow_us_results.json")

        # Print summary
        print(f"\n🏆 Top 20 US Developers by Reputation:\n")
        for i, user in enumerate(users_with_github[:20], 1):
            print(f"{i:2}. {user['username']:30} (Rep: {user['reputation']:6}) - {user['location']}")
            print(f"    {user['github_url']}")

        conn.close()

if __name__ == "__main__":
    scraper = StackOverflowUSMaxScraper(API_KEY)
    scraper.run()
