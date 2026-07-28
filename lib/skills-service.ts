import { DefaultResourceLoader, getAgentDir } from "@earendil-works/pi-coding-agent";
import type { SkillInfo, SkillsResponse } from "@/lib/api-types";
import { listSkillArchiveInstallations } from "@/lib/skill-archive-install";
import { annotateSkillsWithInstallInfo } from "@/lib/skill-lock";
import { getProjectTrustStatus, projectTrustReloadOptions } from "@/lib/project-trust";

export async function loadSkillsWithInstallInfo(cwd: string): Promise<SkillsResponse> {
  const agentDir = getAgentDir();
  const loader = new DefaultResourceLoader({ cwd, agentDir });
  await loader.reload(projectTrustReloadOptions(cwd, agentDir));
  const { skills, diagnostics } = loader.getSkills();
  const packageAnnotated = annotateSkillsWithInstallInfo(skills as SkillInfo[], { cwd, agentDir });
  const archiveInstallations = await listSkillArchiveInstallations({ cwd, agentDir });
  const archiveByScopeAndName = new Map(
    archiveInstallations.map((installation) => [
      `${installation.scope}\0${installation.skillName}`,
      installation,
    ]),
  );
  return {
    skills: packageAnnotated.map((skill) => {
      const scope = skill.sourceInfo.scope === "project"
        ? "project"
        : skill.sourceInfo.scope === "user"
          ? "global"
          : undefined;
      const archive = scope
        ? archiveByScopeAndName.get(`${scope}\0${skill.name}`)
        : undefined;
      return archive
        ? {
            ...skill,
            archiveInstall: {
              kind: archive.kind,
              scope: archive.scope,
              integrationId: archive.integrationId,
              mcpServer: archive.mcpServer,
            },
          }
        : skill;
    }),
    diagnostics,
    projectResourcesLoaded: getProjectTrustStatus(cwd, agentDir).trusted,
  };
}
