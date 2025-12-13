// Mock student history service
import { StudentHistory } from '../types';

export const getStudentHistoryByEmail = async (emailOrId?: string): Promise<StudentHistory> => {
  // For demo purposes return deterministic mock data based on input
  const seed = (emailOrId || '').charCodeAt(0) || 65;
  const base = (seed % 10) + 70; // between 70-79

  const pastScores = [base - 5, base - 2, base, base + 4];
  const attendance = [80 + (seed % 6), 82 + (seed % 5), 85 + (seed % 4), 88 + (seed % 3)];
  const semesters = ['Sem 1', 'Sem 2', 'Sem 3', 'Sem 4'];
  const studyHours = [1.5 + (seed % 3) * 0.5, 2 + (seed % 3) * 0.5, 2.5 + (seed % 3) * 0.5, 3 + (seed % 3) * 0.5];

  return {
    name: emailOrId || 'Student',
    email: emailOrId || '',
    semesters,
    pastScores,
    attendance,
    studyHours
  } as StudentHistory;
};

export default { getStudentHistoryByEmail };