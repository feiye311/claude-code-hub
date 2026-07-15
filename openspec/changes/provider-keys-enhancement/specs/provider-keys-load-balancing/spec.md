## ADDED Requirements

### Requirement: Weighted load balancing

The system SHALL select provider keys based on weight ratio algorithm.

#### Scenario: Select key by weight ratio
- **WHEN** key1 has weight 1 with 2 connections and key2 has weight 2 with 3 connections
- **THEN** system calculates ratio key1=2/1=2, key2=3/2=1.5 and selects key2

#### Scenario: All keys same weight
- **WHEN** all keys have weight 1
- **THEN** system selects key with minimum connections (least connections fallback)

#### Scenario: Single key available
- **WHEN** only one key exists for provider
- **THEN** system always selects that key regardless of weight

### Requirement: Exclude disabled keys

The system SHALL exclude keys with is_enabled=false from load balancing.

#### Scenario: Disabled key not selected
- **WHEN** provider has 2 keys, one disabled
- **THEN** system only selects from enabled key

### Requirement: Exclude circuit-open keys

The system SHALL exclude keys in circuit-open state from load balancing.

#### Scenario: Circuit-open key bypassed
- **WHEN** key has circuit-open status
- **THEN** system skips that key and selects next available key

#### Scenario: All keys circuit-open
- **WHEN** all keys are circuit-open
- **THEN** system selects key with minimum ratio as fallback (with warning)