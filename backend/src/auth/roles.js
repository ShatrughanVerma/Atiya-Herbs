// Role ids are the designation ids of the database view VW_EmpDesignationMaster (the company's own list).
// users.role_id stores the id. The app and the permission checks use the short name below.
// The view is read-only from our side, so ids are listed here and kept in step with it.
const ROLE_IDS = {
  admin: 1,
  md: 2,
  director: 3,
  manager: 4,
  agent: 5,
  teamLeader: 6,
  notAssigned: 7,
  hrAdmin: 8,
  departmentHead: 9,
  doctor: 12,
  pcm: 13,
  customer: 14,
  distributor: 15,
  moderator: 16,
};

const DEFAULT_ROLE_ID = ROLE_IDS.customer;
const ROLE_NAME_BY_ID = new Map(Object.entries(ROLE_IDS).map(([name, id]) => [id, name]));
const ROLES = Object.keys(ROLE_IDS);

const roleNameOf = roleId => ROLE_NAME_BY_ID.get(roleId) ?? null;

module.exports = {ROLES, ROLE_IDS, DEFAULT_ROLE_ID, roleNameOf};
