// shared domain errors. lives in core so the key service can raise it
// without importing from a facade (facades sit ON core, not under it).

export class VaultKeyUnavailableError extends Error {
  constructor(personaId, detail) {
    super(`vault key unavailable for persona ${personaId}: ${detail}`);
    this.name = 'VaultKeyUnavailableError';
    this.personaId = personaId;
  }
}
