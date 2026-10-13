if (typeof window !== 'undefined') throw new Error('Planner AIS modules must run on the server.')

export { PlannerAisClient, parseGradeDetails } from './client.js'
export type { PlannerAisOptions } from './client.js'
export { auditGradeSnapshot, normalizeGrades, normalizeTimetable } from './normalize.js'
export { PlannerAisError } from './errors.js'
export { FetchAisTransport, FetchAisTransportFactory } from './transport.js'
export type * from './types.js'
export type { CaptchaSolver } from './upstream/application/ports/gateway-session.js'
export type { AisGradesQuery } from './upstream/protocol/ais/grades-query.js'
