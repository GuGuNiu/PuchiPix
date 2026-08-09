import sqlite3
import json

db_path = r'E:\data\Github\PuchiPix\data\puchipix.db'

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Check kanav site configuration
print("=== Checking Kanav Site Configuration ===")

# Read site-configs.json
with open(r'E:\data\Github\PuchiPix\backend\internal\sites\data\site-configs.json', 'r', encoding='utf-8') as f:
    config = json.load(f)

kanav_config = config.get('sites', {}).get('kanav', {})
print(f"Kanav module config:")
print(f"  BaseURL: {kanav_config.get('module', {}).get('baseUrl')}")
print(f"  Domains: {kanav_config.get('module', {}).get('domains')}")
print(f"  Enabled: {kanav_config.get('module', {}).get('enabled')}")

# Check download_tasks for kanav
print("\n=== Checking Download Tasks ===")
cursor.execute("SELECT id, url, m3u8_url, status, site_id, error_msg FROM download_tasks WHERE site_id = 'kanav' OR url LIKE '%kanav%'")
rows = cursor.fetchall()
for row in rows:
    print(f"  ID={row[0]}, URL={row[1][:80]}..., M3U8={row[2][:50] if row[2] else 'None'}, Status={row[3]}, SiteID={row[4]}, Error={row[5]}")

# Check if there are any events showing domain fallback
print("\n=== Checking Recent Events for Domain Fallback ===")
cursor.execute("SELECT seq, dag_id, type, substr(payload, 1, 200) FROM dag_events ORDER BY seq DESC LIMIT 10")
events = cursor.fetchall()
for event in events:
    print(f"  Seq={event[0]}, DAG={event[1]}, Type={event[2]}, Payload={event[3]}")

conn.close()
