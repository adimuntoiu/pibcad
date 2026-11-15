import { describe, it, expect, beforeEach } from 'vitest';
import { webglCoordinator } from './webglCoordinator.svelte';

describe('webglCoordinator', () => {
	beforeEach(() => {
		// Reset state
		webglCoordinator.activeSlideId = null;
	});

	it('starts with no active context', () => {
		expect(webglCoordinator.activeSlideId).toBe(null);
		expect(webglCoordinator.isActive('slide-1')).toBe(false);
	});

	it('activates a single slide', () => {
		webglCoordinator.activate('slide-1');
		expect(webglCoordinator.isActive('slide-1')).toBe(true);
		expect(webglCoordinator.isActive('slide-2')).toBe(false);
	});

	it('enforces at most one active context at a time', () => {
		webglCoordinator.activate('slide-1');
		expect(webglCoordinator.isActive('slide-1')).toBe(true);

		// Activating another slide preempts the previous one
		webglCoordinator.activate('slide-2');
		expect(webglCoordinator.isActive('slide-1')).toBe(false);
		expect(webglCoordinator.isActive('slide-2')).toBe(true);
	});

	it('deactivates only when matching active slide', () => {
		webglCoordinator.activate('slide-1');
		webglCoordinator.deactivate('slide-2'); // Should not deactivate slide-1
		expect(webglCoordinator.isActive('slide-1')).toBe(true);

		webglCoordinator.deactivate('slide-1');
		expect(webglCoordinator.isActive('slide-1')).toBe(false);
		expect(webglCoordinator.activeSlideId).toBe(null);
	});
});
