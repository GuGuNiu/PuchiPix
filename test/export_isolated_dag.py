import sqlite3
import json
import os

db_path = r'E:\data\Github\PuchiPix\data\puchipix.db'
export_dir = r'E:\data\Github\PuchiPix\test'
dag_id = 'ZW5FKN'

print(f"Exporting isolated DAG '{dag_id}' data...")

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Export dag_events for this DAG
cursor.execute("SELECT * FROM dag_events WHERE dag_id = ?", (dag_id,))
events = cursor.fetchall()
colnames = [desc[0] for desc in cursor.description]

events_data = []
for row in events:
    events_data.append(dict(zip(colnames, row)))

# Save to JSON
export_file = os.path.join(export_dir, f'isolated_dag_{dag_id}_events.json')
with open(export_file, 'w', encoding='utf-8') as f:
    json.dump(events_data, f, indent=2, ensure_ascii=False)
print(f"Exported {len(events_data)} events to: {export_file}")

# Also check for any other tables referencing this DAG
cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = [row[0] for row in cursor.fetchall()]

print(f"\nChecking all tables for references to DAG '{dag_id}':")
for table in tables:
    try:
        cursor.execute(f"SELECT COUNT(*) FROM `{table}` WHERE dag_id = ?", (dag_id,))
        count = cursor.fetchone()[0]
        if count > 0:
            print(f"  {table}: {count} rows")
            # Export these rows too
            cursor.execute(f"SELECT * FROM `{table}` WHERE dag_id = ?", (dag_id,))
            rows = cursor.fetchall()
            colnames = [desc[0] for desc in cursor.description]
            data = [dict(zip(colnames, row)) for row in rows]
            export_file = os.path.join(export_dir, f'isolated_dag_{dag_id}_{table}.json')
            with open(export_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
    except:
        pass

conn.close()
print("\nExport complete!")
