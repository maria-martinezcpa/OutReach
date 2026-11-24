import requests
import sqlite3
import time
import json
from datetime import datetime

API_KEY = "rl_XVXhbYgKvvHfDPC4kQNXQHjpj"
BASE_URL = "https://api.stackexchange.com/2.3"
DATABASE = "stackoverflow_eu_mega.db"

class StackOverflowEUMegaScraper:
    def __init__(self, api_key):
        self.api_key = api_key
        self.session = requests.Session()
        self.init_database()
        self.github_users = 0

    def init_database(self):
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

    def is_eu_location(self, location):
        if not location:
            return False

        eu_keywords = [
            'germany', 'france', 'uk', 'united kingdom', 'spain', 'italy',
            'netherlands', 'belgium', 'switzerland', 'austria', 'sweden',
            'denmark', 'norway', 'finland', 'poland', 'romania', 'hungary',
            'czech republic', 'czechia', 'slovak', 'ukraine', 'greece',
            'portugal', 'ireland', 'iceland', 'malta', 'cyprus', 'latvia',
            'estonia', 'lithuania', 'slovenia', 'croatia', 'serbia', 'bulgaria',
            'london', 'paris', 'berlin', 'amsterdam', 'brussels', 'zurich',
            'vienna', 'stockholm', 'copenhagen', 'oslo', 'helsinki', 'warsaw',
            'prague', 'budapest', 'athens', 'lisbon', 'dublin', 'reykjavik',
            'geneva', 'barcelona', 'madrid', 'rome', 'cologne', 'hamburg',
            'munich', 'frankfurt', 'rotterdam', 'antwerp', 'turin', 'milan',
            'de,', 'fr,', 'uk,', 'gb,', 'es,', 'it,', 'nl,', 'be,', 'ch,',
            'at,', 'se,', 'no,', 'fi,', 'pl,', 'cz,', 'ie,',
            ', de', ', fr', ', uk', ', gb', ', es', ', it', ', nl', ', be', ', ch',
            ', at', ', se', ', no', ', fi', ', pl', ', cz', ', ie'
        ]

        location_lower = location.lower().strip()
        return any(keyword in location_lower for keyword in eu_keywords)

    def save_user(self, user_data):
        conn = sqlite3.connect(DATABASE)
        cursor = conn.cursor()

        try:
            cursor.execute('''
                INSERT OR REPLACE INTO users
                (user_id, username, reputation, location, website, github_url, profile_url, created_at, scraped_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                user_data['user_id'], user_data['display_name'], user_data['reputation'],
                user_data.get('location', ''), user_data.get('website', ''),
                user_data.get('github_url', ''), user_data.get('link', ''),
                user_data.get('creation_date', ''), datetime.now().isoformat()
            ))
            conn.commit()
            if user_data.get('github_url'):
                self.github_users += 1
        except:
            pass
        finally:
            conn.close()

    def extract_github_url(self, website_url):
        if not website_url or "github.com" not in website_url.lower():
            return None
        url = website_url.lower()
        if not url.startswith("http"):
            url = "https://" + url
        return url

    def fetch_all_users(self, min_reputation=1, max_pages=200):
        page = 1
        has_more = True
        total_found = 0

        print(f"\n🔍 Searching EU developers...")

        while has_more and page <= max_pages:
            try:
                params = {
                    'order': 'desc', 'sort': 'reputation', 'site': 'stackoverflow',
                    'key': self.api_key, 'pagesize': 100, 'page': page
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
                    if not self.is_eu_location(location):
                        continue

                    website = user.get('website_url', '')
                    github_url = self.extract_github_url(website)

                    if github_url:
                        self.save_user({
                            'user_id': user['user_id'],
                            'display_name': user['display_name'],
                            'reputation': user['reputation'],
                            'location': location,
                            'website': website,
                            'github_url': github_url,
                            'link': user.get('link', ''),
                            'creation_date': datetime.fromtimestamp(user['creation_date']).isoformat()
                        })
                        total_found += 1

                        if total_found % 100 == 0:
                            print(f"  ✓ Found {total_found} EU developers... (page {page})")

                has_more = data.get('has_more', False)
                page += 1
                time.sleep(0.2)

            except Exception as e:
                time.sleep(1)
                continue

        return total_found

    def run(self):
        print("=" * 80)
        print("EU DEVELOPERS - MEGA SCRAPER")
        print("=" * 80)
        print("Goal: Find 1000+ EU developers with GitHub")
        print("Search: 200 pages")
        print("Filter: EU locations only")
        print("=" * 80)

        self.fetch_all_users(min_reputation=1, max_pages=200)

        print(f"\n✅ COMPLETE! Found {self.github_users} EU developers")
        self.export_results()

    def export_results(self):
        conn = sqlite3.connect(DATABASE)
        cursor = conn.cursor()
        cursor.execute('SELECT user_id, username, reputation, location, github_url, profile_url FROM users WHERE github_url IS NOT NULL ORDER BY reputation DESC')
        rows = cursor.fetchall()

        users = [{
            'user_id': row[0], 'username': row[1], 'reputation': row[2],
            'location': row[3], 'github_url': row[4], 'profile_url': row[5]
        } for row in rows]

        with open('github_links_eu_mega.txt', 'w') as f:
            for user in users:
                f.write(user['github_url'] + '\n')

        with open('stackoverflow_eu_mega_results.json', 'w') as f:
            json.dump(users, f, indent=2)

        with open('stackoverflow_eu_mega_results.csv', 'w') as f:
            f.write("Username,Reputation,Location,GitHub URL,Profile URL\n")
            for user in users:
                f.write(f'{user["username"]},{user["reputation"]},"{user["location"]}",{user["github_url"]},{user["profile_url"]}\n')

        print(f"📄 Exported {len(users)} EU GitHub links to github_links_eu_mega.txt")
        conn.close()

if __name__ == "__main__":
    scraper = StackOverflowEUMegaScraper(API_KEY)
    scraper.run()
