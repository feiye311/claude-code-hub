## ADDED Requirements

### Requirement: Provider Key CRUD

The system SHALL allow administrators to create, read, update, and delete provider keys through REST API and Web UI.

#### Scenario: Create provider key
- **WHEN** administrator creates a new key for a provider with weight 2
- **THEN** system stores the key in provider_keys table with weight 2 and is_enabled true

#### Scenario: List provider keys
- **WHEN** administrator views provider detail page
- **THEN** system displays all keys with their weight, enabled status, and circuit state

#### Scenario: Update key weight
- **WHEN** administrator changes key weight from 1 to 3
- **THEN** system updates weight and subsequent load balancing reflects new ratio

#### Scenario: Disable key manually
- **WHEN** administrator sets is_enabled to false for a key
- **THEN** system excludes that key from load balancing immediately

### Requirement: Key weight validation

The system SHALL enforce minimum weight of 1 for all provider keys.

#### Scenario: Reject invalid weight
- **WHEN** administrator attempts to set weight to 0 or negative
- **THEN** system rejects with validation error

### Requirement: Key cascade delete

The system SHALL delete all provider keys when parent provider is deleted.

#### Scenario: Delete provider with keys
- **WHEN** administrator deletes a provider
- **THEN** system cascades delete all associated keys in provider_keys table
