export class ConflictError extends Error {
  constructor(msg = '다른 사용자가 먼저 저장했습니다.') { super(msg); this.name = 'ConflictError'; this.code = 'CONFLICT'; }
}
