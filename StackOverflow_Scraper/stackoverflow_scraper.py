import requests
import sqlite3
import time
import json
from datetime import datetime

# Configuration
API_KEY = "rl_XVXhbYgKvvHfDPC4kQNXQHjpj"
BASE_URL = "https://api.stackexchange.com/2.3"
TAGS = ["javascript", "python", "java", "react", "nodejs", "typescript", "rust", "golang", "csharp", "cpp"]
DATABASE = "stackoverflow_users.db"

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
            # Clean up the URL
            url = website_url.lower()
            if not url.startswith("http"):
                url = "https://" + url
            return url
        return None

    def fetch_users_by_tag(self, tag, min_reputation=100):
        """Fetch users by tag from Stack Overflow API"""
        page = 1
        has_more = True
        users_in_tag = 0

        print(f"\n🔍 Searching tag: {tag}")

        while has_more and page <= 10:  # Limit to 10 pages per tag
            try:
                params = {
                    'order': 'desc',
                    'sort': 'reputation',
                    'tagged': tag,
                    'site': 'stackoverflow',
                    'key': self.api_key,
                    'pagesize': 100,
                    'page': page,
                    'filter': '!9Z(-wCoGEZ)Ss6_xQryoLEA'  # Include extra fields
                }

                response = self.session.get(f"{BASE_URL}/users", params=params)
                response.raise_for_status()

                data = response.json()

                if 'items' not in data:
                    print(f"⚠️  No items in response for tag {tag} page {page}")
                    break

                users = data['items']

                if not users:
                    print(f"✅ No more users found for {tag}")
                    break

                for user in users:
                    # Filter by reputation
                    if user['reputation'] < min_reputation:
                        continue

                    github_url = self.extract_github_url(user.get('website_url', ''))

                    user_data = {
                        'user_id': user['user_id'],
                        'display_name': user['display_name'],
                        'reputation': user['reputation'],
                        'location': user.get('location', ''),
                        'website': user.get('website_url', ''),
                        'github_url': github_url,
                        'link': user.get('link', ''),
                        'creation_date': datetime.fromtimestamp(user['creation_date']).isoformat()
                    }

                    self.save_user(user_data)
                    users_in_tag += 1

                    if github_url:
                        print(f"  ✓ {user['display_name']} (rep: {user['reputation']}) - {github_url}")

                has_more = data.get('has_more', False)
                page += 1

                # Rate limiting - 1 request per second
                time.sleep(0.5)

            except requests.exceptions.RequestException as e:
                print(f"❌ API Error on page {page}: {e}")
                time.sleep(2)
                continue

        print(f"📊 Found {users_in_tag} users with reputation >= {min_reputation} for tag: {tag}")
        return users_in_tag

    def fetch_users_by_reputation(self, min_reputation=1000, max_pages=5):
        """Fetch top users by reputation"""
        page = 1
        has_more = True
        users_found = 0

        print(f"\n🔍 Searching top users (reputation >= {min_reputation})")

        while has_more and page <= max_pages:
            try:
                params = {
                    'order': 'desc',
                    'sort': 'reputation',
                    'site': 'stackoverflow',
                    'key': self.api_key,
                    'pagesize': 100,
                    'page': page
                }

                response = self.session.get(f"{BASE_URL}/users", params=params)
                response.raise_for_status()

                data = response.json()
                users = data.get('items', [])

                if not users:
                    break

                for user in users:
                    if user['reputation'] < min_reputation:
                        has_more = False
                        break

                    github_url = self.extract_github_url(user.get('website_url', ''))

                    user_data = {
                        'user_id': user['user_id'],
                        'display_name': user['display_name'],
                        'reputation': user['reputation'],
                        'location': user.get('location', ''),
                        'website': user.get('website_url', ''),
                        'github_url': github_url,
                        'link': user.get('link', ''),
                        'creation_date': datetime.fromtimestamp(user['creation_date']).isoformat()
                    }

                    self.save_user(user_data)
                    users_found += 1

                    if github_url:
                        print(f"  ✓ {user['display_name']} (rep: {user['reputation']}) - {github_url}")

                has_more = data.get('has_more', False)
                page += 1
                time.sleep(0.5)

            except requests.exceptions.RequestException as e:
                print(f"❌ API Error: {e}")
                time.sleep(2)
                continue

        print(f"📊 Found {users_found} top users")
        return users_found

    def run(self):
        """Run the scraper"""
        print("=" * 60)
        print("Stack Overflow User Scraper")
        print("=" * 60)

        # Scrape by tags
        total = 0
        for tag in TAGS:
            count = self.fetch_users_by_tag(tag, min_reputation=50)
            total += count

        # Scrape top users
        count = self.fetch_users_by_reputation(min_reputation=5000, max_pages=3)
        total += count

        print("\n" + "=" * 60)
        print(f"✅ Scraping complete!")
        print(f"📊 Total unique users saved: {self.users_found}")
        print(f"💾 Database: {DATABASE}")
        print("=" * 60)

        self.export_results()

    def export_results(self):
        """Export results to JSON"""
        conn = sqlite3.connect(DATABASE)
        cursor = conn.cursor()

        cursor.execute('''
            SELECT * FROM users WHERE github_url IS NOT NULL
            ORDER BY reputation DESC
        ''')

        rows = cursor.fetchall()

        # Export to JSON
        users_with_github = []
        for row in rows:
            users_with_github.append({
                'user_id': row[0],
                'username': row[1],
                'reputation': row[2],
                'location': row[3],
                'website': row[4],
                'github_url': row[5],
                'profile_url': row[6]
            })

        with open('stackoverflow_users_github.json', 'w') as f:
            json.dump(users_with_github, f, indent=2)

        print(f"\n📄 Exported {len(users_with_github)} users with GitHub links to: stackoverflow_users_github.json")

        # Print summary
        print(f"\nTop 10 users by reputation:")
        cursor.execute('''
            SELECT username, reputation, github_url FROM users
            WHERE github_url IS NOT NULL
            ORDER BY reputation DESC LIMIT 10
        ''')

        for i, (username, rep, github) in enumerate(cursor.fetchall(), 1):
            print(f"{i}. {username} (rep: {rep}) - {github}")

        conn.close()

if __name__ == "__main__":
    scraper = StackOverflowScraper(API_KEY)
    scraper.run()
