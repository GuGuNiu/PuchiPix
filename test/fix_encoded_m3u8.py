import sqlite3
import base64
import urllib.parse

db_path = r'E:\data\Github\PuchiPix\data\puchipix.db'
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Find all tasks with encoded m3u8_url
cursor.execute("SELECT id, m3u8_url FROM download_tasks WHERE m3u8_url != ''")
rows = cursor.fetchall()

for row in rows:
    task_id = row[0]
    raw_url = row[1]
    
    # Check if it looks like base64
    try:
        decoded = base64.b64decode(raw_url).decode('utf-8')
        if '%' in decoded:
            final_url = urllib.parse.unquote(decoded)
            print(f"Task {task_id}: {raw_url[:40]}... -> {final_url}")
            cursor.execute("UPDATE download_tasks SET m3u8_url = ? WHERE id = ?", (final_url, task_id))
        elif decoded.startswith('http'):
            print(f"Task {task_id}: {raw_url[:40]}... -> {decoded}")
            cursor.execute("UPDATE download_tasks SET m3u8_url = ? WHERE id = ?", (decoded, task_id))
        else:
            print(f"Task {task_id}: already decoded or unknown format: {raw_url[:40]}...")
    except Exception as e:
        print(f"Task {task_id}: not base64 ({e}), URL: {raw_url[:40]}...")

conn.commit()
conn.close()
print("\nDatabase m3u8_url fix complete!")
