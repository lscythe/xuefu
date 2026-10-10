import type { ProcessRunner } from "../../application/ports/process-runner";
import type { SecretFailure, SecretProvider } from "../../application/ports/secret-provider";
import type { SecretRegistry } from "../../application/security/redaction";
import { configurationError, processError } from "../../domain/shared/errors";
import type { AbsolutePath } from "../../domain/shared/path";
import { err, ok, type Result } from "../../domain/shared/result";
import { type Secret, type SecretRef, secret } from "../../domain/shared/secret";
import { stableStringify } from "../../domain/shared/stable-json";

const KEYCHAIN_TIMEOUT_MS = 30_000;
/** `security` exits with this when no item matches. */
const MACOS_NOT_FOUND = 44;

/**
 * Credentials from the environment, the macOS keychain (`security`) or the Secret Service on Linux
 * (`secret-tool`). Each is looked up once, and registered so it is masked in every output.
 */
export class SystemSecrets implements SecretProvider {
  readonly #resolved = new Map<string, Secret>();

  constructor(
    private readonly env: Readonly<Record<string, string | undefined>>,
    private readonly processes: ProcessRunner,
    private readonly platform: NodeJS.Platform,
    private readonly registry: SecretRegistry,
  ) {}

  async resolve(ref: SecretRef, signal?: AbortSignal): Promise<Result<Secret, SecretFailure>> {
    const key = stableStringify(ref);
    const known = this.#resolved.get(key);
    if (known !== undefined) return ok(known);
    const found =
      "env" in ref ? this.fromEnvironment(ref.env) : await this.fromKeychain(ref.keychain, signal);
    if (!found.ok) return found;
    this.registry.register(found.value);
    const value = secret(found.value);
    this.#resolved.set(key, value);
    return ok(value);
  }

  private fromEnvironment(name: string): Result<string, SecretFailure> {
    const value = this.env[name];
    if (value !== undefined && value !== "") return ok(value);
    return err(
      configurationError(`The environment variable ${name} is not set`, "environment", [
        { path: name, message: "set it to the credential, or keep it in the keychain instead" },
      ]),
    );
  }

  private async fromKeychain(
    item: { readonly service: string; readonly account: string },
    signal: AbortSignal | undefined,
  ): Promise<Result<string, SecretFailure>> {
    const command = this.keychainCommand(item);
    if (command === null) {
      return err(
        configurationError(`XueFu cannot read the keychain on ${this.platform}`, "keychain", [
          { path: item.service, message: "keep the credential in an environment variable instead" },
        ]),
      );
    }
    const ran = await this.processes.run(
      { command: command.program, args: command.args, cwd: "/" as AbsolutePath, env: command.env },
      { timeoutMs: KEYCHAIN_TIMEOUT_MS, ...(signal === undefined ? {} : { signal }) },
    );
    if (!ran.ok) return ran;
    const { exitCode, stdout } = ran.value;
    // The value ends with the newline the tool prints after it; anything else is part of it.
    const value = stdout.replace(/\r?\n$/, "");
    if (exitCode === 0 && value !== "") return ok(value);
    if (exitCode === 0 || exitCode === command.notFound) {
      return err(
        configurationError(`No keychain item for ${item.service} (${item.account})`, "keychain", [
          { path: `${item.service}/${item.account}`, message: `add it with: ${command.addWith}` },
        ]),
      );
    }
    return err(
      processError(`${command.program} could not read the keychain`, command.program, exitCode),
    );
  }

  private keychainCommand(item: { readonly service: string; readonly account: string }) {
    switch (this.platform) {
      case "darwin":
        return {
          program: "security",
          args: ["find-generic-password", "-s", item.service, "-a", item.account, "-w"],
          env: {},
          notFound: MACOS_NOT_FOUND,
          addWith: `security add-generic-password -s ${item.service} -a ${item.account} -w`,
        };
      case "linux": {
        // The Secret Service is reached over the session bus, which the child must be told of.
        const bus = this.env["DBUS_SESSION_BUS_ADDRESS"];
        return {
          program: "secret-tool",
          args: ["lookup", "service", item.service, "account", item.account],
          env: bus === undefined ? {} : { DBUS_SESSION_BUS_ADDRESS: bus },
          notFound: 1,
          addWith: `secret-tool store --label=${item.service} service ${item.service} account ${item.account}`,
        };
      }
      default:
        return null;
    }
  }
}
