# Stack Overflow User Scraper

Extract GitHub links and contact information from Stack Overflow developers using the official Stack Overflow API.

## 📋 Files

1. **stackoverflow_scraper.py** - Basic scraper for all users
2. **stackoverflow_scraper_us.py** - US developers only
3. **stackoverflow_scraper_advanced.py** - Advanced with custom filters ⭐ Recommended

## 🔑 Setup

### 1. Get API Key
- Visit: https://stackapps.com/apps/oauth
- Sign in with your Stack Overflow account
- Register a new application
- Copy your **API Key**

### 2. Update the Script
Replace the API key in any script:
```python
API_KEY = "your_api_key_here"
```

### 3. Install Dependencies
```bash
pip install requests
```

## 🚀 Usage

### Option 1: Basic Scraper
```bash
python stackoverflow_scraper.py
```
Scrapes all users across multiple tags.

### Option 2: US Developers Only
```bash
python stackoverflow_scraper_us.py
```
Finds US-based developers with GitHub links.

### Option 3: Advanced with Custom Filters (RECOMMENDED)
Edit the filters in `stackoverflow_scraper_advanced.py`:

```python
filters = {
    'tags': ['javascript', 'python', 'react'],           # Technologies
    'min_reputation': 100,                                # Min reputation
    'max_reputation': 50000,                              # Max reputation
    'locations': ['USA', 'California', 'New York'],       # Include locations
    'exclude_locations': ['India', 'China'],              # Exclude locations
    'has_github': True,                                   # Must have GitHub
    'max_pages': 20                                       # Pages to search
}
```

Then run:
```bash
python stackoverflow_scraper_advanced.py
```

## 📊 Output Files

The scripts generate:
- **`stackoverflow_results.json`** - Full data in JSON format
- **`stackoverflow_results.csv`** - Spreadsheet compatible format
- **`stackoverflow_advanced.db`** - SQLite database (for local queries)

## 📄 Output Format

### JSON Example:
```json
{
  "user_id": 12345,
  "username": "john_developer",
  "reputation": 15000,
  "location": "California, USA",
  "github_url": "https://github.com/john_developer",
  "profile_url": "https://stackoverflow.com/users/12345/john-developer"
}
```

### CSV Columns:
```
Username,Reputation,Location,GitHub URL,Profile URL
john_developer,15000,"California, USA",https://github.com/john_developer,https://stackoverflow.com/users/12345/john-developer
```

## ⚙️ Filter Examples

### Example 1: US Frontend Developers
```python
filters = {
    'tags': ['javascript', 'react', 'typescript'],
    'min_reputation': 500,
    'locations': ['USA', 'California', 'New York', 'Texas'],
    'has_github': True,
    'max_pages': 15
}
```

### Example 2: Python Experts (Worldwide)
```python
filters = {
    'tags': ['python'],
    'min_reputation': 5000,
    'has_github': True,
    'max_pages': 10
}
```

### Example 3: Rust Developers (Non-EU)
```python
filters = {
    'tags': ['rust'],
    'min_reputation': 100,
    'exclude_locations': ['Germany', 'UK', 'France', 'Sweden', 'Europe'],
    'has_github': True,
    'max_pages': 20
}
```

## ⚠️ Important Notes

- **Rate Limits**: 10,000 requests/day with API key
- **Scraping**: Uses official Stack Overflow API (not scraping)
- **Speed**: Takes 2-10 minutes depending on filters
- **Database**: Data is stored locally in SQLite for reuse

## 🔗 Integration with Upwork Out Reach

Once you have GitHub links, you can:
1. Extract email from GitHub profiles
2. Find additional contact info from GitHub bios
3. Use for professional outreach

## 📝 License

Use responsibly and respect Stack Overflow's Terms of Service.
