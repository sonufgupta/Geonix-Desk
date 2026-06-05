import sqlite3
import json
import os
import sys

# Support UTF-8
sys.stdout.reconfigure(encoding='utf-8')

db_path = r"c:\Users\Dell\OneDrive\Desktop\pdf-invoice-extractor\orders.db"
if not os.path.exists(db_path):
    print("orders.db does not exist at:", db_path)
    sys.exit(1)

try:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Check tables
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = cursor.fetchall()
    print("Tables in database:", tables)
    
    for table in tables:
        table_name = table[0]
        cursor.execute(f"SELECT COUNT(*) FROM {table_name}")
        count = cursor.fetchone()[0]
        print(f"Table '{table_name}' has {count} records.")
        
        # Print a few records
        cursor.execute(f"SELECT * FROM {table_name} LIMIT 5")
        rows = cursor.fetchall()
        print(f"Sample records from '{table_name}':")
        for row in rows:
            print(row)
            
    conn.close()
except Exception as e:
    print("Error reading SQLite database:", e)
