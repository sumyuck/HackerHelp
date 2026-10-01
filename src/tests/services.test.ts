import mongoose from 'mongoose';
import { calculateWeightedScore, validateTeamSize } from './test-helpers';
import { logger } from '../logger';

// A lightweight mock unit test structure to verify constraints
async function runTests() {
  logger.info('Starting HackerHelp constraints validation tests...');
  let failed = false;

  // Test 1: Team size validation (Min 3 members)
  try {
    const valid = validateTeamSize(['user1', 'user2', 'user3']);
    if (!valid) throw new Error('Expected 3 members to be valid.');
    
    const invalid = validateTeamSize(['user1', 'user2']);
    if (invalid) throw new Error('Expected 2 members to be invalid.');

    logger.info('✔ Test 1 passed: Team size validation enforces minimum 3 members.');
  } catch (err: any) {
    logger.error('✘ Test 1 failed:', err.message);
    failed = true;
  }

  // Test 2: Rubrics-based weighted score calculation
  try {
    const scores = {
      innovation: 10,
      technicalComplexity: 8,
      implementation: 9,
      scalability: 8,
      presentation: 7,
      businessValue: 9,
      ux: 8,
      impact: 9
    };
    
    const weighted = calculateWeightedScore(scores);
    const expected = 8.5; // (10+8+9+8+7+9+8+9)/8 = 68/8 = 8.5
    
    if (weighted !== expected) {
      throw new Error(`Expected weighted score of ${expected}, but got ${weighted}.`);
    }

    logger.info(`✔ Test 2 passed: Weighted scoring calculated correctly (${weighted}/10).`);
  } catch (err: any) {
    logger.error('✘ Test 2 failed:', err.message);
    failed = true;
  }

  if (failed) {
    logger.error('Some tests failed. Check implementation logic.');
    process.exit(1);
  } else {
    logger.info('All constraints tests passed successfully!');
    process.exit(0);
  }
}

runTests();
