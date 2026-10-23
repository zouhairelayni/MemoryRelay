// INTEGRATION SLOT for the skill selector you already built.
//
// Replace the body of this component (or re-export your own component from this file).
// The Skills screen renders it like this:
//
//   <SkillSelector connections={[{ id, name, revoked }]} />
//
// Suggested wiring when you are ready:
//   1. Server: add worker/skills.js (list, enable/disable per connection) and routes in worker/api.js
//      under /api/skills. Store the choices in a D1 table, for example skill_grants(connection_id, skill_id).
//   2. Client: add skills to src/api/endpoints.js and a useSkills hook next to the other hooks.
//   3. MCP: expose the enabled skills to each agent from worker/mcp.js (tools/list can filter by connection).
export default function SkillSelector({ connections }) {
  return (
    <div className="card slot">
      <div className="eyebrow">Skill selector</div>
      <p className="muted small" style={{ margin: "8px 0 0" }}>
        Your skill selector mounts here. {connections.length} connection{connections.length === 1 ? "" : "s"} available to assign skills to.
      </p>
    </div>
  );
}
