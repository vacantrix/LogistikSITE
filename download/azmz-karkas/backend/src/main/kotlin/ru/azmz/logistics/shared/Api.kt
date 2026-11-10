package ru.azmz.logistics.shared

/**
 * Статус применения операции outbox.
 * Повторная доставка того же opId обязана давать тот же статус:
 * идемпотентность — на unique(op_id) в sync_operation + уникальных PK сущностей.
 */
enum class OpStatus { APPLIED, DUPLICATE, REJECTED }

/** Результат применения одной операции конкретным applier-ом. */
data class ApplyOutcome(val status: OpStatus, val rejectReason: String? = null)
