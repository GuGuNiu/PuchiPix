import sqlite3

db_path = r'E:\data\Github\PuchiPix\data\puchipix.db'
dag_id = 'ZW5FKN'

print(f"Removing isolated DAG '{dag_id}' from main database...")

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Delete dag_events for this DAG
cursor.execute("DELETE FROM dag_events WHERE dag_id = ?", (dag_id,))
deleted = cursor.rowcount
conn.commit()

print(f"Deleted {deleted} event rows for DAG '{dag_id}'")

# Verify
cursor.execute("SELECT COUNT(*) FROM dag_events WHERE dag_id = ?", (dag_id,))
remaining = cursor.fetchone()[0]
print(f"Remaining events for '{dag_id}': {remaining}")

# Show remaining DAGs
cursor.execute("SELECT DISTINCT dag_id FROM dag_events")
dags = cursor.fetchall()
print(f"\nRemaining DAGs in database: {len(dags)}")
for dag in dags:
    print(f"  {dag[0]}")

conn.close()
print("\nCleanup complete!")
