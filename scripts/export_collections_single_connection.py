#!/usr/bin/env python3
"""
MongoDB Collections Exporter - Single Connection
Connects once, exports all specified collections, then disconnects.
This is MUCH faster than running mongoexport for each collection.
"""

import sys
import json
import os
from datetime import datetime
from pymongo import MongoClient
from bson import ObjectId, Decimal128
from datetime import datetime as dt

def json_serialize(obj):
    """Convert MongoDB types to JSON-serializable types"""
    if isinstance(obj, ObjectId):
        return str(obj)
    elif isinstance(obj, dt):
        return obj.isoformat()
    elif isinstance(obj, Decimal128):
        return float(str(obj))
    elif isinstance(obj, bytes):
        return obj.decode('utf-8', errors='ignore')
    return obj

def export_collection(db, collection_name, output_file):
    """Export a single collection to JSON file"""
    try:
        collection = db[collection_name]
        
        # Get all documents
        documents = list(collection.find({}))
        
        # Convert MongoDB types to JSON-serializable
        for doc in documents:
            for key, value in list(doc.items()):
                doc[key] = json_serialize(value)
        
        # Write to file
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(documents, f, ensure_ascii=False, indent=2, default=json_serialize)
        
        return len(documents)
    except Exception as e:
        print(f"ERROR: Failed to export {collection_name}: {str(e)}", file=sys.stderr)
        return -1

def main():
    if len(sys.argv) < 5:
        print("Usage: export_collections_single_connection.py <mongo_uri> <db_name> <tmp_dir> <timestamp> [collection1,collection2,...]", file=sys.stderr)
        sys.exit(1)
    
    mongo_uri = sys.argv[1]
    db_name = sys.argv[2]
    tmp_dir = sys.argv[3]
    timestamp = sys.argv[4]
    
    # If collections specified, use them; otherwise get all collections
    specific_collections = sys.argv[5].split(',') if len(sys.argv) > 5 and sys.argv[5] else None
    
    client = None
    try:
        # ✅ CONNECT ONCE
        print(f"{datetime.now().strftime('%a %b %d %H:%M:%S %z %Y')}: Connecting to MongoDB...", file=sys.stderr)
        client = MongoClient(mongo_uri, serverSelectionTimeoutMS=10000)
        
        # Verify connection
        client.server_info()
        print(f"{datetime.now().strftime('%a %b %d %H:%M:%S %z %Y')}: ✅ Connected to MongoDB", file=sys.stderr)
        
        db = client[db_name]
        
        # Get list of collections
        if specific_collections:
            collections = specific_collections
        else:
            collections = db.list_collection_names()
            # Filter out system collections
            collections = [c for c in collections if not c.startswith('system.')]
        
        total_collections = len(collections)
        print(f"{datetime.now().strftime('%a %b %d %H:%M:%S %z %Y')}: Found {total_collections} collections to export", file=sys.stderr)
        
        # Export each collection (reusing the same connection)
        for idx, coll_name in enumerate(collections, 1):
            print(f"{datetime.now().strftime('%a %b %d %H:%M:%S %z %Y')}: [{idx}/{total_collections}] Exporting collection: {coll_name} ...", file=sys.stderr)
            
            output_file = os.path.join(tmp_dir, f"{coll_name}_{timestamp}.json")
            record_count = export_collection(db, coll_name, output_file)
            
            if record_count >= 0:
                print(f"{datetime.now().strftime('%a %b %d %H:%M:%S %z %Y')}: ✅ Exported {record_count} records from {coll_name}", file=sys.stderr)
                # Output filename for shell script to process
                print(output_file)
            else:
                print(f"{datetime.now().strftime('%a %b %d %H:%M:%S %z %Y')}: ❌ Failed to export {coll_name}", file=sys.stderr)
        
        print(f"{datetime.now().strftime('%a %b %d %H:%M:%S %z %Y')}: ✅ All collections exported successfully", file=sys.stderr)
        
    except Exception as e:
        print(f"{datetime.now().strftime('%a %b %d %H:%M:%S %z %Y')}: ❌ ERROR: {str(e)}", file=sys.stderr)
        sys.exit(1)
    finally:
        # ✅ DISCONNECT ONCE
        if client:
            client.close()
            print(f"{datetime.now().strftime('%a %b %d %H:%M:%S %z %Y')}: Disconnected from MongoDB", file=sys.stderr)

if __name__ == '__main__':
    main()
