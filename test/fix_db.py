import sqlite3
import os

db_path = r'E:\data\Github\PuchiPix\data\puchipix.db'

print(f"Connecting to: {db_path}")
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Check current schema
cursor.execute("PRAGMA table_info(download_tasks)")
columns = cursor.fetchall()
print("Current columns in download_tasks:")
for col in columns:
    print(f"  {col[1]} ({col[2]})")

# Check if title column exists
has_title = any(col[1] == 'title' for col in columns)
if has_title:
    print("\n'title' column already exists!")
else:
    print("\nAdding 'title' column...")
    cursor.execute("ALTER TABLE download_tasks ADD COLUMN title TEXT NOT NULL DEFAULT ''")
    conn.commit()
    print("Column added successfully!")

# Verify
cursor.execute("PRAGMA table_info(download_tasks)")
columns = cursor.fetchall()
print("\nUpdated columns in download_tasks:")
for col in columns:
    print(f"  {col[1]} ({col[2]})")

conn.close()
print("\nDone!")
