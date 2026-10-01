import { IRubricScores } from '../database/models';

export function validateTeamSize(members: string[]): boolean {
  return members.length >= 3;
}

export function calculateWeightedScore(scores: IRubricScores): number {
  const sum = 
    scores.innovation +
    scores.technicalComplexity +
    scores.implementation +
    scores.scalability +
    scores.presentation +
    scores.businessValue +
    scores.ux +
    scores.impact;
  return parseFloat((sum / 8).toFixed(2));
}
