import { Inject, Injectable } from '../utils/inversify';
import { ProfileStore } from '../profile/profile-store';
import {
    assertProfileEnvVarUniqueness,
    describeUnusableProfile,
    getProfileApiKeyEnvVar,
    RESOLVED_PROFILE,
    type ResolvedProfile,
} from '../profile/resolved-profile';
import { KnownError } from '../utils/error';

@Injectable()
export class ConfigSetHandler {
    constructor(
        @Inject(ProfileStore) private readonly profileStore: ProfileStore,
        @Inject(RESOLVED_PROFILE) private readonly resolvedProfile: ResolvedProfile,
    ) {}

    async run({ name, value }: { name: string; value: string }): Promise<void> {
        const profile = this.resolvedProfile.name;

        // A broken profile must not be silently rewritten: config set on an
        // invalid profile would persist a merged defaults-over-broken-state
        // file, destroying whatever made it invalid. Fix the profile with
        // `aicommits setup` instead.
        if (this.resolvedProfile.status === 'invalid') {
            throw new KnownError(describeUnusableProfile(this.resolvedProfile).join('\n'));
        }

        // The derived API key env var must stay unique per profile - saving a
        // colliding profile would let one profile's credential resolve as the
        // other profile's key.
        assertProfileEnvVarUniqueness(this.profileStore.getProfileNames(), profile);

        this.profileStore.updateProfile(profile, { [name]: value });
        await this.profileStore.save();

        let apiKeyHint = '';
        if (name === 'apiKey') {
            apiKeyHint = ` The env var for shell-provided credentials is ${getProfileApiKeyEnvVar(profile)}.`;
        }
        console.log(`Configuration property "${name}" set to "${value}" in profile "${profile}".${apiKeyHint}`);
    }
}
