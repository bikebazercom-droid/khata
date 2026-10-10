-- Cover the app's most frequent ledger reads: a party's newest entries and
-- resolving both sides of linked transfers.
CREATE INDEX IF NOT EXISTS ledger_entries_party_created_idx
  ON ledger_entries (party_id, created_at);

CREATE INDEX IF NOT EXISTS ledger_entries_transfer_party_idx
  ON ledger_entries (transfer_party_id);

CREATE INDEX IF NOT EXISTS ledger_entries_linked_entry_idx
  ON ledger_entries (linked_entry_id);

-- Party lists are business-scoped and ordered by most recent activity.
CREATE INDEX IF NOT EXISTS parties_business_recent_activity_idx
  ON parties (business_id, last_transaction_at, created_at);
