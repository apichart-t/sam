import { Report, Project, Unit, ProjectGroup } from '../types';
import { DEFAULT_PROJECTS, DEFAULT_UNITS } from '../constants';

const KEYS = {
    REPORTS: 'j1_reports',
    PROJECTS: 'j1_projects',
    UNITS: 'j1_units',
    GROUPS: 'j1_groups'
};

// Simple event system for "real-time" updates
const listeners: { [key: string]: Function[] } = {
    reports: [],
    projects: [],
    units: [],
    groups: []
};

const notify = (key: string, data: any[]) => {
    if (listeners[key]) {
        listeners[key].forEach(cb => cb(data));
    }
};

const load = <T>(key: string): T[] => {
    try {
        const str = localStorage.getItem(key);
        return str ? JSON.parse(str) : [];
    } catch (e) {
        console.error("Error loading from localStorage", e);
        return [];
    }
};

const save = (key: string, data: any[]) => {
    try {
        localStorage.setItem(key, JSON.stringify(data));
        notify(key === KEYS.REPORTS ? 'reports' : 
               key === KEYS.PROJECTS ? 'projects' : 
               key === KEYS.UNITS ? 'units' : 'groups', data);
    } catch (e) {
        console.error("Error saving to localStorage", e);
    }
};

// --- SUBSCRIPTIONS ---

export const subscribeToReports = (callback: (reports: Report[]) => void) => {
    listeners['reports'].push(callback);
    callback(load<Report>(KEYS.REPORTS));
    return () => {
        listeners['reports'] = listeners['reports'].filter(cb => cb !== callback);
    };
};

export const subscribeToProjects = (callback: (projects: Project[]) => void) => {
    listeners['projects'].push(callback);
    callback(load<Project>(KEYS.PROJECTS));
    return () => {
        listeners['projects'] = listeners['projects'].filter(cb => cb !== callback);
    };
};

export const subscribeToUnits = (callback: (units: Unit[]) => void) => {
    listeners['units'].push(callback);
    const units = load<Unit>(KEYS.UNITS);
    // Default migration for old data
    const safeUnits = units.map(u => ({ ...u, password: u.password || '123' }));
    callback(safeUnits);
    return () => {
        listeners['units'] = listeners['units'].filter(cb => cb !== callback);
    };
};

export const subscribeToGroups = (callback: (groups: ProjectGroup[]) => void) => {
    listeners['groups'].push(callback);
    callback(load<ProjectGroup>(KEYS.GROUPS));
    return () => {
        listeners['groups'] = listeners['groups'].filter(cb => cb !== callback);
    };
};

// --- CRUD ---

export const saveReport = async (report: Report): Promise<void> => {
    const reports = load<Report>(KEYS.REPORTS);
    const index = reports.findIndex(r => r.id === report.id);
    if (index >= 0) {
        reports[index] = report;
    } else {
        reports.push(report);
    }
    save(KEYS.REPORTS, reports);
};

export const deleteReport = async (id: string): Promise<void> => {
    let reports = load<Report>(KEYS.REPORTS);
    reports = reports.filter(r => r.id !== id);
    save(KEYS.REPORTS, reports);
};

export const getReports = async (): Promise<Report[]> => {
    return load<Report>(KEYS.REPORTS);
};

export const initializeProjects = async () => {
    const projects = load<Project>(KEYS.PROJECTS);
    if (projects.length === 0) {
        console.log("Seeding default projects to LocalStorage...");
        save(KEYS.PROJECTS, DEFAULT_PROJECTS);
    }
    
    const units = load<Unit>(KEYS.UNITS);
    if (units.length === 0) {
        console.log("Seeding default units to LocalStorage...");
        save(KEYS.UNITS, DEFAULT_UNITS);
    }
};

export const saveProject = async (project: Project, oldProject?: Project): Promise<void> => {
    const projects = load<Project>(KEYS.PROJECTS);
    const index = projects.findIndex(p => p.id === project.id);
    if (index >= 0) {
        projects[index] = project;
    } else {
        projects.push(project);
    }
    save(KEYS.PROJECTS, projects);

    // Sync details
    if (oldProject) {
        const nameChanged = oldProject.name !== project.name;
        const unitChanged = oldProject.unitId !== project.unitId;
        if (nameChanged || unitChanged) {
             const reports = load<Report>(KEYS.REPORTS);
             let changed = false;
             reports.forEach(r => {
                 if (r.projectId === project.id) {
                     r.projectName = project.name;
                     r.unitId = project.unitId;
                     changed = true;
                 }
             });
             if (changed) save(KEYS.REPORTS, reports);
        }
    }
};

export const softDeleteProject = async (id: string): Promise<void> => {
    const projects = load<Project>(KEYS.PROJECTS);
    const p = projects.find(p => p.id === id);
    if (p) {
        p.deletedAt = Date.now();
        save(KEYS.PROJECTS, projects);
    }
};

export const restoreProject = async (id: string): Promise<void> => {
    const projects = load<Project>(KEYS.PROJECTS);
    const p = projects.find(p => p.id === id);
    if (p) {
        delete p.deletedAt;
        save(KEYS.PROJECTS, projects);
    }
};

export const deleteProject = async (id: string): Promise<void> => {
    let projects = load<Project>(KEYS.PROJECTS);
    projects = projects.filter(p => p.id !== id);
    save(KEYS.PROJECTS, projects);

    let reports = load<Report>(KEYS.REPORTS);
    const initialLen = reports.length;
    reports = reports.filter(r => r.projectId !== id);
    if (reports.length !== initialLen) {
        save(KEYS.REPORTS, reports);
    }
};

export const getProjects = async (): Promise<Project[]> => {
    return load<Project>(KEYS.PROJECTS);
};

export const cleanupTrash = async (): Promise<void> => {
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - THIRTY_DAYS_MS;
    
    let projects = load<Project>(KEYS.PROJECTS);
    const toDelete = projects.filter(p => p.deletedAt && p.deletedAt < cutoff);
    
    if (toDelete.length > 0) {
        projects = projects.filter(p => !p.deletedAt || p.deletedAt >= cutoff);
        save(KEYS.PROJECTS, projects);
        
        let reports = load<Report>(KEYS.REPORTS);
        const toDeleteIds = new Set(toDelete.map(p => p.id));
        reports = reports.filter(r => !toDeleteIds.has(r.projectId));
        save(KEYS.REPORTS, reports);
        
        console.log(`Cleaned up ${toDelete.length} expired projects.`);
    }
};

export const saveProjectGroup = async (group: ProjectGroup): Promise<void> => {
    const groups = load<ProjectGroup>(KEYS.GROUPS);
    const index = groups.findIndex(g => g.id === group.id);
    if (index >= 0) {
        groups[index] = group;
    } else {
        groups.push(group);
    }
    save(KEYS.GROUPS, groups);
};

export const deleteProjectGroup = async (id: string): Promise<void> => {
    let groups = load<ProjectGroup>(KEYS.GROUPS);
    groups = groups.filter(g => g.id !== id);
    save(KEYS.GROUPS, groups);
    
    // Update projects
    const projects = load<Project>(KEYS.PROJECTS);
    let changed = false;
    projects.forEach(p => {
        if (p.groupId === id) {
            delete p.groupId;
            changed = true;
        }
    });
    if (changed) save(KEYS.PROJECTS, projects);
};

export const saveUnit = async (unit: Unit): Promise<void> => {
    const units = load<Unit>(KEYS.UNITS);
    const index = units.findIndex(u => u.id === unit.id);
    if (index >= 0) {
        units[index] = unit;
    } else {
        units.push(unit);
    }
    save(KEYS.UNITS, units);
};

export const deleteUnit = async (id: string): Promise<void> => {
    let units = load<Unit>(KEYS.UNITS);
    units = units.filter(u => u.id !== id);
    save(KEYS.UNITS, units);

    // Cascade Projects
    let projects = load<Project>(KEYS.PROJECTS);
    projects = projects.filter(p => p.unitId !== id);
    save(KEYS.PROJECTS, projects);

    // Cascade Reports
    let reports = load<Report>(KEYS.REPORTS);
    reports = reports.filter(r => r.unitId !== id);
    save(KEYS.REPORTS, reports);
};

export const getUnits = async (): Promise<Unit[]> => {
    return load<Unit>(KEYS.UNITS);
};

export const getAvailableYearsFromList = (projects: Project[]): string[] => {
    const activeProjects = projects.filter(p => !p.deletedAt);
    const years = Array.from(new Set(activeProjects.map(p => p.fiscalYear || "2569"))).sort((a, b) => b.localeCompare(a));
    if(years.length === 0) return ["2569"];
    return years;
}

export const exportBackupData = async () => {
    const data = {
        reports: load(KEYS.REPORTS),
        projects: load(KEYS.PROJECTS),
        units: load(KEYS.UNITS),
        groups: load(KEYS.GROUPS),
        timestamp: Date.now(),
        version: '2.0 (Local)'
    };
    return JSON.stringify(data, null, 2);
};

export const importBackupData = async (jsonString: string): Promise<boolean> => {
    try {
        const data = JSON.parse(jsonString);
        if (!data.reports || !data.projects || !data.units) throw new Error("Invalid format");

        save(KEYS.REPORTS, data.reports);
        save(KEYS.PROJECTS, data.projects);
        save(KEYS.UNITS, data.units);
        if(data.groups) save(KEYS.GROUPS, data.groups);

        return true;
    } catch (e) {
        console.error(e);
        return false;
    }
};
