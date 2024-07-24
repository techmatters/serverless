import os
import json
import sys
import gspread
from google.oauth2.service_account import Credentials
from google.auth.exceptions import GoogleAuthError
from datetime import datetime

def main():
  try:
    # Load credentials from the environment variable
    credentials_json = os.getenv('GOOGLE_SHEETS_CREDENTIALS')
    sheet_id = os.getenv('GOOGLE_SHEET_ID')

    if not credentials_json:
      raise ValueError("Credentials JSON not found in environment variable.")
    if not sheet_id:
      raise ValueError("Sheet ID not found in environment variable.")

    credentials_data = json.loads(credentials_json)
    print("Credentials loaded successfully.")

    # Define the scope and credentials
    scopes = [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file'
    ]
    credentials = Credentials.from_service_account_info(credentials_data, scopes=scopes)
    print("Credentials initialized successfully.")

    client = gspread.authorize(credentials)
    print("Google Sheets client authorized successfully.")

    sheet = client.open_by_key(sheet_id).worksheet("Deploys")
    print("Google Sheet opened successfully.")

    current_date = datetime.now().strftime("%m/%d/%Y")
    current_time = datetime.now().strftime("%H:%M:%S")

    helpline = os.getenv('helpline')
    environments = os.getenv('environments')
    environment = os.getenv('environment')
    github_ref = os.getenv('github_ref')
    github_sha = os.getenv('github_sha')
    github_actor = os.getenv('github_actor')
    github_branch = os.getenv('github_branch')
    aws_region = os.getenv('aws_region')

    print("Environment variables loaded successfully.")

    hl_env = helpline + "_" + environment

    new_row = [current_date, current_time, "serverless", hl_env , environments, github_ref, aws_region, github_actor, github_branch, github_sha]
    append_row = sheet.append_row(new_row)
    print("Row added to Deploys sheet.")

    if not append_row:
      raise RuntimeError("Failed to add row to Deploys sheet.")

    print("Google Sheet updated successfully.")

  except (GoogleAuthError, ValueError, RuntimeError, json.JSONDecodeError) as e:
    print(f"Error: {e}")
    sys.exit(1)

if __name__ == '__main__':
  main()
