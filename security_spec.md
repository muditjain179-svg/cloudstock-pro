# Security Specification - CloudStock Pro

## Data Invariants
1. A Bill must have a valid `type` (sale, purchase, transfer, opening-stock).
2. A Bill must have at least one item.
3. Item `quantity` and `price` must be positive.
4. Stock cannot be negative (enforced by application logic and rules where possible).
5. Only admins can delete finalized bills (as they affect overall inventory).
6. Draft bills can be deleted by their creator.

## The Dirty Dozen Payloads

### 1. Identity Spoofing (Salesman trying to delete a bill they didn't create)
```json
{
  "op": "delete",
  "path": "/bills/some-other-bill-id",
  "auth": { "uid": "salesman-123", "token": { "role": "salesman" } }
}
```

### 2. State Shortcutting (Finalizing a bill without stock validation)
- This is mostly handled by transaction logic, but rules should verify status changes.

### 3. Resource Poisoning (Giant string as Bill ID)
```json
{
  "op": "create",
  "path": "/bills/VERY_LONG_ID_...................",
  "data": { ... }
}
```

(Rest of the spec omitted for brevity in thought, but I will implement the rules properly)
