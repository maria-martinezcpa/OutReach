import requests
import sqlite3
import time
import json
from datetime import datetime

# Configuration
API_KEY = "rl_XVXhbYgKvvHfDPC4kQNXQHjpj"
BASE_URL = "https://api.stackexchange.com/2.3"
TAGS = ["javascript", "python", "java", "react", "nodejs", "typescript", "rust", "golang", "csharp", "cpp"]
DATABASE = "stackoverflow_users_us.db"

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
            ', ca', ', ny', ', tx', ', fl', ', wa', ', ma', ', il', ', az', ', co'
        ]

        location_lower = location.lower().strip()
        return any(keyword in location_lower for keyword in us_keywords)

    def fetch_users_by_tag(self, tag, min_reputation=100):
        """Fetch users by tag from Stack Overflow API - US only"""
        page = 1
        has_more = True
        users_in_tag = 0

        print(f"\n🔍 Searching tag: {tag} (US users)")

        while has_more and page <= 20:
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
                    if not self.is_us_location(location):
                        continue

                    github_url = self.extract_github_url(user.get('website_url', ''))

                    user_data = {
                        'user_id': user['user_id'],
                        'display_name': user['display_name'],
                        'reputation': user['reputation'],
                        'location': location,
                        'website': user.get('website_url', ''),
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

        print(f"📊 Found {users_in_tag} US users for tag: {tag}")
        return users_in_tag

    def run(self):
        """Run the scraper"""
        print("=" * 70)
        print("Stack Overflow User Scraper - US Developers with GitHub Links")
        print("=" * 70)

        total = 0
        for tag in TAGS:
            count = self.fetch_users_by_tag(tag, min_reputation=50)
            total += count

        print("\n" + "=" * 70)
        print(f"✅ Scraping complete!")
        print(f"📊 Total US users found: {self.users_found}")
        print(f"💾 Database: {DATABASE}")
        print("=" * 70)

        self.export_results()

    def export_results(self):
        """Export results to JSON"""
        conn = sqlite3.connect(DATABASE)
        cursor = conn.cursor()

        # Get all users with GitHub
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

        # Export to JSON
        with open('us_developers_github.json', 'w') as f:
            json.dump(users_with_github, f, indent=2)

        print(f"\n📄 Exported {len(users_with_github)} US developers with GitHub to: us_developers_github.json")

        # Export to CSV
        with open('us_developers_github.csv', 'w') as f:
            f.write("Username,Reputation,Location,GitHub URL,Profile URL\n")
            for user in users_with_github:
                f.write(f'{user["username"]},{user["reputation"]},"{user["location"]}",{user["github_url"]},{user["profile_url"]}\n')

        print(f"📄 Also exported to: us_developers_github.csv")

        # Print top 20
        print(f"\n🏆 Top 20 US Developers by Reputation:\n")
        cursor.execute('''
            SELECT username, reputation, location, github_url FROM users
            WHERE github_url IS NOT NULL
            ORDER BY reputation DESC LIMIT 20
        ''')

        for i, (username, rep, location, github) in enumerate(cursor.fetchall(), 1):
            print(f"{i:2}. {username:25} (Rep: {rep:5}) - {location:20} - {github}")

        conn.close()

if __name__ == "__main__":
    scraper = StackOverflowScraper(API_KEY)
    scraper.run()
