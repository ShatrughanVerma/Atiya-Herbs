const {notFound} = require('../common/errors');
const {pageArgs, pageOf} = require('../common/paging');

const GROUP_KINDS = ['conference', 'meeting'];

// Call and meeting history of the logged-in person. People are matched by mobile number (what the call server
// uses), always the number of the account in the login token.
function createHistoryService({prisma}) {
  const mobileOf = async userId => {
    const user = await prisma.user.findUnique({where: {id: userId}});
    if (!user || user.status !== 'active') {
      throw notFound('Account not found.');
    }
    return user.mobile;
  };

  return {
    // One-to-one voice and video calls, newest first
    async calls(userId, query) {
      const me = await mobileOf(userId);
      const where = {kind: {in: ['voice', 'video']}, OR: [{callerMobile: me}, {calleeMobile: me}]};
      const [rows, total] = await Promise.all([
        prisma.callLog.findMany({where, orderBy: {startedAt: 'desc'}, ...pageArgs(query)}),
        prisma.callLog.count({where}),
      ]);
      const items = rows.map(row => {
        const outgoing = row.callerMobile === me;
        return {
          id: row.id,
          kind: row.kind,
          direction: outgoing ? 'outgoing' : 'incoming',
          peerMobile: outgoing ? row.calleeMobile : row.callerMobile,
          outcome: row.outcome,
          startedAt: row.startedAt,
          endedAt: row.endedAt,
          durationSec: row.durationSec,
        };
      });
      return pageOf(items, total, query);
    },

    // Meetings and conference calls this person took part in
    async meetings(userId, query) {
      const me = await mobileOf(userId);
      const where = {kind: {in: GROUP_KINDS}, callerMobile: me};
      const [rows, total] = await Promise.all([
        prisma.callLog.findMany({where, orderBy: {startedAt: 'desc'}, ...pageArgs(query)}),
        prisma.callLog.count({where}),
      ]);
      const items = rows.map(row => ({
        id: row.id,
        kind: row.kind,
        meetingId: row.meetingId,
        title: row.title,
        outcome: row.outcome,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        durationSec: row.durationSec,
      }));
      return pageOf(items, total, query);
    },

    // The chat of one meeting, as THIS person saw it: what they sent, what was sent to them alone, and what was
    // sent to everyone. A private message between two other people is never returned. Only people who took
    // part in the meeting can read it.
    async meetingMessages(userId, meetingId, query) {
      const me = await mobileOf(userId);
      const took = await prisma.callLog.findFirst({where: {kind: {in: GROUP_KINDS}, meetingId, callerMobile: me}});
      if (!took) {
        throw notFound('Meeting not found.');
      }
      const where = {meetingId, OR: [{fromMobile: me}, {toMobile: me}, {toMobile: null}]};
      const [rows, total] = await Promise.all([
        prisma.meetingMessage.findMany({where, orderBy: {sentAt: 'asc'}, ...pageArgs(query)}),
        prisma.meetingMessage.count({where}),
      ]);
      const items = rows.map(row => ({
        id: row.id,
        from: {name: row.fromName},
        mine: row.fromMobile === me,
        private: row.toMobile !== null && row.toMobile !== undefined,
        text: row.text,
        sentAt: row.sentAt,
      }));
      return pageOf(items, total, query);
    },
  };
}

module.exports = {createHistoryService};
