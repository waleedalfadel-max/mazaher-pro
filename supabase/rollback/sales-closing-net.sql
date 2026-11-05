-- The alias is backward-compatible merchant configuration. Keep it when rolling back the guard.
drop trigger if exists check_sales_closing_net on approval_private.document_invoices;
drop function if exists approval_private.check_sales_closing_net();
