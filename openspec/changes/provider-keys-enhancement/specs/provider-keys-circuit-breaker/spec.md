## ADDED Requirements

### Requirement: Key-level circuit breaker

The system SHALL maintain independent circuit breaker state per provider key.

#### Scenario: Key circuit opens on failures
- **WHEN** key experiences failures reaching circuitBreakerFailureThreshold
- **THEN** system opens circuit for that specific key only

#### Scenario: Key circuit auto-recovers
- **WHEN** circuit-open duration elapses and key succeeds in half-open state
- **THEN** system closes circuit and key becomes available for load balancing

### Requirement: Manual circuit reset

The system SHALL allow administrators to manually reset circuit breaker state for a key.

#### Scenario: Admin resets circuit
- **WHEN** administrator clicks reset button for circuit-open key
- **THEN** system clears circuit state and key becomes available immediately

### Requirement: Circuit state query

The system SHALL provide API endpoint to query circuit breaker state for each key.

#### Scenario: Query key circuit state
- **WHEN** administrator requests provider keys list
- **THEN** system returns each key's circuit state (closed/open/half-open)

### Requirement: Reuse provider circuit parameters

The system SHALL reuse provider-level circuit breaker parameters for key-level circuit.

#### Scenario: Key circuit uses provider thresholds
- **WHEN** provider has circuitBreakerFailureThreshold=5 and circuitBreakerOpenDuration=1800000
- **THEN** key circuit uses same thresholds and duration