# Firestore Security Specification

## Data Invariants
1. A user can only access their own profile (except Admin).
2. Only Admin can manage (create/update/delete) items, suppliers, and purchase bills.
3. Only Admin can initiate stock transfers.
4. Salesmen can only create and view sales bills.
5. Salesmen can only view their own inventory.
6. Admin can see everyone's inventory and all bills.
7. Finalized bills can only be deleted by Admin.

## The "Dirty Dozen" Payloads (Denial Tests)
1. **Identity Spoofing**: Salesman trying to create a purchase bill as Admin.
2. **Role Escalation**: User trying to change their role from 'salesman' to 'admin'.
3. **Stock Injection**: Salesman trying to increase their stock directly without a transfer.
4. **Item Sabotage**: Salesman trying to delete or rename an item in the main catalog.
5. **Supplier Theft**: Salesman trying to list or modify supplier data.
6. **Bill Forging**: Salesman trying to set a sales bill date in the future or past (must match server time).
7. **Negative Stock**: Trying to transfer or sell -10 items.
8. **Shadow Fields**: Adding `isVerified: true` to a user profile or bill.
9. **Inventory Bypass**: A salesman trying to read another salesman's inventory.
10. **Admin Locked Out**: User trying to delete an admin record to break access.
11. **Malicious ID**: Using a 2MB string as a Customer ID to exploit storage/costs.
12. **Finalized Edit**: Salesman trying to edit a bill after it is marked 'finalized'.

## Test Runner (Logic)
The `firestore.rules` will be verified against these scenarios using helpers and strict path matching.
