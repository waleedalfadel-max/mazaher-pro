-- Rollback of 20261103090000_invoice_correction.sql: removes the correction functions and the document-row lock.
-- Corrections already saved stay as they are (their rows and history entries are ordinary approved data). Direct edits of document
-- entries become possible again.
drop trigger if exists document_rows_guard on public.ledger_entries;
drop trigger if exists document_rows_guard on public.document_items;
drop trigger if exists document_rows_guard on public.supplier_transactions;
drop function if exists approval_private.document_rows_guard();
drop function if exists public.approval_correct_invoice(uuid, uuid, uuid, integer, jsonb, text, jsonb, jsonb);
drop function if exists public.approval_correction_prepare(uuid, uuid);
