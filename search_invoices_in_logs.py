import os
import json
import sys

# Support UTF-8 on Windows
sys.stdout.reconfigure(encoding='utf-8')

log_path = r"C:\Users\Dell\.gemini\antigravity\brain\eaaec5c5-1736-4f3c-b683-6b8e62e5752e\.system_generated\logs\transcript.jsonl"
if not os.path.exists(log_path):
    print("Log file not found at path.")
    sys.exit(1)

print("Reading chat transcript to locate past invoice uploads and records...")

all_records = []
invoice_numbers = set()

with open(log_path, 'r', encoding='utf-8') as f:
    for line in f:
        try:
            data = json.loads(line)
            # Search in tool calls arguments for reconcileDocument or getLocalRecords contents
            for tc in data.get('tool_calls', []):
                args_str = tc.get('function', {}).get('arguments', '')
                if not args_str:
                    continue
                try:
                    args = json.loads(args_str)
                except Exception:
                    continue
                
                # Check if this tool call was writing/modifying records containing list of invoices
                # (e.g. write_to_file or replace_file_content or database operations)
                if isinstance(args, dict):
                    # Check if it has 'CodeContent' or 'ReplacementContent'
                    content_str = args.get('CodeContent', '') or args.get('ReplacementContent', '')
                    if content_str and ('invoice_number' in content_str or 'geonix_reconciled_db' in content_str):
                        # Try parsing as JSON if it represents a JSON data list
                        try:
                            # Search for JSON arrays in the content
                            start_idx = content_str.find('[')
                            end_idx = content_str.rfind(']')
                            if start_idx != -1 and end_idx != -1:
                                array_str = content_str[start_idx:end_idx+1]
                                parsed_array = json.loads(array_str)
                                if isinstance(parsed_array, list):
                                    for item in parsed_array:
                                        if isinstance(item, dict) and 'invoice_number' in item:
                                            inv_num = item.get('invoice_number')
                                            if inv_num and inv_num not in invoice_numbers:
                                                invoice_numbers.add(inv_num)
                                                all_records.append(item)
                        except Exception:
                            pass
            
            # Check if there are raw messages containing records
            content = data.get('content', '')
            if content and ('geonix_reconciled_db' in content or 'invoice_number' in content):
                # Search for potential JSON
                try:
                    start_idx = content.find('[')
                    end_idx = content.rfind(']')
                    if start_idx != -1 and end_idx != -1:
                        array_str = content[start_idx:end_idx+1]
                        parsed_array = json.loads(array_str)
                        if isinstance(parsed_array, list):
                            for item in parsed_array:
                                if isinstance(item, dict) and 'invoice_number' in item:
                                    inv_num = item.get('invoice_number')
                                    if inv_num and inv_num not in invoice_numbers:
                                        invoice_numbers.add(inv_num)
                                        all_records.append(item)
                except Exception:
                    pass
        except Exception:
            pass

print(f"Extraction complete. Found {len(all_records)} unique records in chat history.")
if all_records:
    # Save the extracted records to a backup file
    backup_file = r"c:\Users\Dell\OneDrive\Desktop\simple-blank-web\recovered_invoices.json"
    with open(backup_file, 'w', encoding='utf-8') as out_f:
        json.dump(all_records, out_f, indent=4)
    print(f"Successfully saved recovered records to: {backup_file}")
else:
    print("No records could be parsed directly from the log file.")
