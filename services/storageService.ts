import { Report, Project, Unit, ProjectGroup } from '../types';
import { DEFAULT_PROJECTS, DEFAULT_UNITS, FIREBASE_CONFIG } from '../constants';
// FIX: Use namespace import for firebase/app to avoid "no exported member" error in some environments
import * as firebaseApp from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  getDocs, 
  setDoc, 
  doc, 
  onSnapshot, 
  query, 
  where, 
  deleteDoc,
  updateDoc,
  limit,
  writeBatch,
  deleteField
} from 'firebase/firestore';

// Initialize Firebase
const app = firebaseApp.initializeApp(FIREBASE_CONFIG);
const db = getFirestore(app);

const COLLECTIONS = {
    REPORTS: 'reports',
    PROJECTS: 'projects',
    UNITS: 'units',
    GROUPS: 'groups'
};

// --- SUBSCRIPTIONS (Real-time) ---

export const subscribeToReports = (callback: (reports: Report[]) => void) => {
    const q = query(collection(db, COLLECTIONS.REPORTS));
    return onSnapshot(q, (snapshot) => {
        const reports = snapshot.docs.map(doc => doc.data() as Report);
        callback(reports);
    }, (error) => {
        console.error("Error subscribing to reports:", error);
    });
};

export const subscribeToProjects = (callback: (projects: Project[]) => void) => {
    const q = query(collection(db, COLLECTIONS.PROJECTS));
    return onSnapshot(q, (snapshot) => {
        const projects = snapshot.docs.map(doc => doc.data() as Project);
        callback(projects);
    }, (error) => {
        console.error("Error subscribing to projects:", error);
    });
};

export const subscribeToUnits = (callback: (units: Unit[]) => void) => {
    const q = query(collection(db, COLLECTIONS.UNITS));
    return onSnapshot(q, (snapshot) => {
        const units = snapshot.docs.map(doc => {
            const data = doc.data() as Unit;
            // Migration for old data
            if (!data.password) data.password = '123'; 
            return data;
        });
        callback(units);
    }, (error) => {
        console.error("Error subscribing to units:", error);
    });
};

export const subscribeToGroups = (callback: (groups: ProjectGroup[]) => void) => {
    const q = query(collection(db, COLLECTIONS.GROUPS));
    return onSnapshot(q, (snapshot) => {
        const groups = snapshot.docs.map(doc => doc.data() as ProjectGroup);
        callback(groups);
    }, (error) => {
        console.error("Error subscribing to groups:", error);
    });
};

// --- CRUD Operations ---

export const saveReport = async (report: Report): Promise<void> => {
    try {
        await setDoc(doc(db, COLLECTIONS.REPORTS, report.id), report);
    } catch (e) {
        console.error("Error saving report:", e);
        throw e;
    }
};

export const deleteReport = async (id: string): Promise<void> => {
    try {
        await deleteDoc(doc(db, COLLECTIONS.REPORTS, id));
    } catch (e) {
        console.error("Error deleting report:", e);
        throw e;
    }
};

export const saveProject = async (project: Project, oldProject?: Project): Promise<void> => {
    try {
        await setDoc(doc(db, COLLECTIONS.PROJECTS, project.id), project);

        // Sync Project Name/Unit to Reports if changed
        if (oldProject) {
            const nameChanged = oldProject.name !== project.name;
            const unitChanged = oldProject.unitId !== project.unitId;
            
            if (nameChanged || unitChanged) {
                // Find related reports
                const q = query(collection(db, COLLECTIONS.REPORTS), where("projectId", "==", project.id));
                const snapshot = await getDocs(q);
                
                const batch = writeBatch(db);
                snapshot.docs.forEach(d => {
                    batch.update(d.ref, {
                        projectName: project.name,
                        unitId: project.unitId
                    });
                });
                await batch.commit();
            }
        }
    } catch (e) {
        console.error("Error saving project:", e);
        throw e;
    }
};

export const softDeleteProject = async (id: string): Promise<void> => {
    try {
        await updateDoc(doc(db, COLLECTIONS.PROJECTS, id), {
            deletedAt: Date.now()
        });
    } catch (e) {
        console.error("Error soft deleting project:", e);
        throw e;
    }
};

export const restoreProject = async (id: string): Promise<void> => {
    try {
        await updateDoc(doc(db, COLLECTIONS.PROJECTS, id), {
            deletedAt: deleteField()
        });
    } catch (e) {
        console.error("Error restoring project:", e);
        throw e;
    }
};

export const deleteProject = async (id: string): Promise<void> => {
    try {
        await deleteDoc(doc(db, COLLECTIONS.PROJECTS, id));
        
        // Delete related reports
        const q = query(collection(db, COLLECTIONS.REPORTS), where("projectId", "==", id));
        const snapshot = await getDocs(q);
        const batch = writeBatch(db);
        snapshot.docs.forEach(d => {
            batch.delete(d.ref);
        });
        await batch.commit();
    } catch (e) {
        console.error("Error deleting project:", e);
        throw e;
    }
};

export const saveUnit = async (unit: Unit): Promise<void> => {
    await setDoc(doc(db, COLLECTIONS.UNITS, unit.id), unit);
};

export const deleteUnit = async (id: string): Promise<void> => {
    await deleteDoc(doc(db, COLLECTIONS.UNITS, id));
    
    // Cascade delete projects and reports would be heavy.
    // Ideally use Cloud Functions. For client-side, we might skip or do batch if small.
    // Let's do client side batch for consistency.
    
    const batch = writeBatch(db);
    
    // Projects
    const qP = query(collection(db, COLLECTIONS.PROJECTS), where("unitId", "==", id));
    const snapP = await getDocs(qP);
    snapP.docs.forEach(d => batch.delete(d.ref));
    
    // Reports
    const qR = query(collection(db, COLLECTIONS.REPORTS), where("unitId", "==", id));
    const snapR = await getDocs(qR);
    snapR.docs.forEach(d => batch.delete(d.ref));
    
    await batch.commit();
};

export const saveProjectGroup = async (group: ProjectGroup): Promise<void> => {
    await setDoc(doc(db, COLLECTIONS.GROUPS, group.id), group);
};

export const deleteProjectGroup = async (id: string): Promise<void> => {
    await deleteDoc(doc(db, COLLECTIONS.GROUPS, id));
    
    // Ungroup projects
    const q = query(collection(db, COLLECTIONS.PROJECTS), where("groupId", "==", id));
    const snapshot = await getDocs(q);
    const batch = writeBatch(db);
    snapshot.docs.forEach(d => {
        batch.update(d.ref, { groupId: deleteField() }); 
    });
    await batch.commit();
};


// --- Initialization ---

export const initializeProjects = async () => {
    try {
        const q = query(collection(db, COLLECTIONS.PROJECTS), limit(1));
        const snapshot = await getDocs(q);
        
        if (snapshot.empty) {
            console.log("Seeding default data to Firestore...");
            const batch = writeBatch(db);
            
            DEFAULT_UNITS.forEach(u => {
                const ref = doc(db, COLLECTIONS.UNITS, u.id);
                batch.set(ref, u);
            });
            
            DEFAULT_PROJECTS.forEach(p => {
                const ref = doc(db, COLLECTIONS.PROJECTS, p.id);
                batch.set(ref, p);
            });
            
            await batch.commit();
            console.log("Seeding complete.");
        }
    } catch (e) {
        console.error("Initialization error:", e);
    }
};

export const cleanupTrash = async (): Promise<void> => {
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - THIRTY_DAYS_MS;
    
    // Client-side filtering approach to avoid index issues for now:
    try {
         const qAll = query(collection(db, COLLECTIONS.PROJECTS)); 
         const snap = await getDocs(qAll);
         const batch = writeBatch(db);
         let count = 0;
         
         snap.docs.forEach(d => {
             const data = d.data() as Project;
             if (data.deletedAt && data.deletedAt < cutoff) {
                 batch.delete(d.ref);
                 count++;
             }
         });
         
         if (count > 0) {
             await batch.commit();
             console.log(`Cleaned up ${count} expired projects.`);
         }
    } catch (e) {
        console.error("Cleanup error:", e);
    }
};

// --- Helpers ---

export const getAvailableYearsFromList = (projects: Project[]): string[] => {
    const activeProjects = projects.filter(p => !p.deletedAt); // Treat 0 or undefined as active
    const years = Array.from(new Set(activeProjects.map(p => p.fiscalYear || "2569"))).sort((a, b) => b.localeCompare(a));
    if(years.length === 0) return ["2569"];
    return years;
};

// --- Getters for One-time fetch (Diagnostics/Export) ---

export const getProjects = async (): Promise<Project[]> => {
    const snap = await getDocs(collection(db, COLLECTIONS.PROJECTS));
    return snap.docs.map(d => d.data() as Project);
};

export const getReports = async (): Promise<Report[]> => {
    const snap = await getDocs(collection(db, COLLECTIONS.REPORTS));
    return snap.docs.map(d => d.data() as Report);
};

export const getUnits = async (): Promise<Unit[]> => {
    const snap = await getDocs(collection(db, COLLECTIONS.UNITS));
    return snap.docs.map(d => d.data() as Unit);
};

// --- Backup ---

export const exportBackupData = async () => {
    const reports = await getReports();
    const projects = await getProjects();
    const units = await getUnits();
    const gSnap = await getDocs(collection(db, COLLECTIONS.GROUPS));
    const groups = gSnap.docs.map(d => d.data() as ProjectGroup);

    const data = {
        reports,
        projects,
        units,
        groups,
        timestamp: Date.now(),
        version: '2.0 (Cloud)'
    };
    return JSON.stringify(data, null, 2);
};

export const importBackupData = async (jsonString: string): Promise<boolean> => {
    try {
        const data = JSON.parse(jsonString);
        if (!data.reports || !data.projects || !data.units) throw new Error("Invalid format");
        
        // Units
        for (const u of data.units) await setDoc(doc(db, COLLECTIONS.UNITS, u.id), u);
        
        // Projects
        for (const p of data.projects) await setDoc(doc(db, COLLECTIONS.PROJECTS, p.id), p);
        
        // Reports
        for (const r of data.reports) await setDoc(doc(db, COLLECTIONS.REPORTS, r.id), r);
        
        // Groups
        if (data.groups) {
             for (const g of data.groups) await setDoc(doc(db, COLLECTIONS.GROUPS, g.id), g);
        }

        return true;
    } catch (e) {
        console.error("Import error:", e);
        return false;
    }
};
