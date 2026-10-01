import { Inject, Injectable } from '../utils/inversify';
import { ConfigService } from '../services/config.service';
import { assertProfileEnvVarUniqueness, getProfileApiKeyEnvVar } from '../utils/resolve-api-key';

@Injectable()
export class ConfigSetHandler {
    constructor(@Inject(ConfigService) private readonly configService: ConfigService) {}

    async run({ name, value, profile }: { name: string; value: string; profile: string }): Promise<void> {
        await this.configService.readConfig();

        // The derived API key env var must stay unique per profile - saving a
        // colliding profile would let one profile's credential resolve as the
        // other profile's key.
        assertProfileEnvVarUniqueness(this.configService.getProfileNames(), profile);

        this.configService.updateProfileInMemory(profile, { [name]: value });
        await this.configService.flush();

        let apiKeyHint = '';
        if (name === 'apiKey') {
            apiKeyHint = ` The env var for shell-provided credentials is ${getProfileApiKeyEnvVar(profile)}.`;
        }
        console.log(`Configuration property "${name}" set to "${value}" in profile "${profile}".${apiKeyHint}`);
    }
}
