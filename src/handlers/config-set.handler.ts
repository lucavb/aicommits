import { Inject, Injectable } from '../utils/inversify';
import { ProfileStore } from '../profile/profile-store';
import { RESOLVED_PROFILE, type ResolvedProfile } from '../profile/resolved-profile';

@Injectable()
export class ConfigSetHandler {
    constructor(
        @Inject(ProfileStore) private readonly profileStore: ProfileStore,
        @Inject(RESOLVED_PROFILE) private readonly resolvedProfile: ResolvedProfile,
    ) {}

    async run({ name, value }: { name: string; value: string }): Promise<void> {
        const profile = this.resolvedProfile.name;
        this.profileStore.updateProfile(profile, { [name]: value });
        await this.profileStore.save();
        console.log(`Configuration property "${name}" set to "${value}" in profile "${profile}".`);
    }
}
