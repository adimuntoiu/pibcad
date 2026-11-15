class WebglCoordinator {
	activeSlideId = $state<string | null>(null);

	activate(slideId: string): void {
		this.activeSlideId = slideId;
	}

	deactivate(slideId: string): void {
		if (this.activeSlideId === slideId) {
			this.activeSlideId = null;
		}
	}

	isActive(slideId: string): boolean {
		return this.activeSlideId === slideId;
	}
}

export const webglCoordinator = new WebglCoordinator();
