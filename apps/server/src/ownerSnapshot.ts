import { roleLabel } from './domain';
import { prisma } from './prisma';
import { photoUrl } from './services';

export interface LivePresence {
  status: string;
  x: number;
  y: number;
}

export async function ownerSnapshot(companyId: string, online: Map<string, LivePresence>) {
  const people = await prisma.membership.findMany({
    where: { companyId, active: true },
    include: { area: true, jobTitle: true },
    orderBy: { name: 'asc' },
  });
  const rooms = await prisma.officeRoom.findMany({ where: { companyId }, include: { area: true } });
  const areas = await prisma.area.findMany({
    where: { companyId },
    include: { kpis: { orderBy: { sort: 'asc' } } },
    orderBy: { name: 'asc' },
  });
  const today = new Date().toISOString().slice(0, 10);
  const reports = await prisma.dailyReport.findMany({
    where: { companyId, date: today },
    include: { values: { include: { kpi: true } }, membership: true },
  });
  const tasks = await prisma.task.findMany({
    where: { companyId, status: { in: ['pendiente', 'en_curso'] } },
    include: { assignee: true, area: true },
    orderBy: { createdAt: 'desc' },
  });

  const peopleDto = people.map((person) => {
    const live = online.get(person.id);
    const since = person.currentTaskSince ? person.currentTaskSince.getTime() : null;
    return {
      id: person.id,
      name: person.name,
      photoUrl: photoUrl(person.photoPath),
      role: person.role,
      puesto: person.jobTitle?.name || roleLabel(person.role),
      areaId: person.areaId,
      areaName: person.area?.name ?? 'Sin área',
      areaColor: person.area?.color ?? '#9A9AA2',
      status: live?.status || 'desconectado',
      online: Boolean(live),
      taskTitle: person.currentTaskTitle || '',
      taskSince: person.currentTaskSince,
      taskSeconds: since ? Math.max(0, Math.round((Date.now() - since) / 1000)) : 0,
      x: live?.x ?? null,
      y: live?.y ?? null,
    };
  });

  const areaDto = areas.map((area) => {
    const inside = peopleDto.filter((person) => person.areaId === area.id);
    const room = rooms.find((item) => item.areaId === area.id);
    const kpis = area.kpis.slice(0, 3).map((kpi) => {
      const total = reports
        .filter((report) => report.membership.areaId === area.id)
        .reduce((sum, report) => sum + (report.values.find((value) => value.kpiId === kpi.id)?.value ?? 0), 0);
      return {
        key: kpi.key,
        label: kpi.label,
        unit: kpi.unit,
        total: Math.round(total * 10) / 10,
        target: kpi.targetDaily,
      };
    });
    return {
      id: area.id,
      name: area.name,
      color: area.color,
      teamName: area.teamName,
      template: area.template,
      mapRoomId: room?.mapRoomId ?? null,
      roomName: room?.name ?? 'Sin zona',
      headcount: inside.length,
      online: inside.filter((person) => person.online).length,
      people: inside.map((person) => ({
        id: person.id,
        name: person.name,
        photoUrl: person.photoUrl,
        status: person.status,
        taskTitle: person.taskTitle,
        online: person.online,
      })),
      kpis,
    };
  });

  return {
    updatedAt: new Date().toISOString(),
    people: peopleDto,
    areas: areaDto,
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      areaId: task.areaId,
      area: task.area.name,
      assigneeId: task.assigneeId,
      assignee: task.assignee?.name ?? null,
    })),
  };
}
