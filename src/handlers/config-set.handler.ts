import { Inject, Injectable } from '../utils/inversify';
import { ConfigService } from '../services/config.service';

@Injectable()
export class ConfigSetHandler {
    constructor(@Inject(ConfigService) private readonly configService: ConfigService) {}

    async run({ name, value, profile }: { name: string; value: string; profile: string }): Promise<void> {
        await this.configService.readConfig();
        this.configService.updateProfileInMemory(profile, { [name]: value });
        await this.configService.flush();
        console.log(`Configuration property "${name}" set to "${value}" in profile "${profile}".`);
    }
}
