/**
 * CHANGELOG.md's newest entry, renamed for a release: `## Unreleased`, or an
 * earlier prerelease of the same version (2.0.0-rc.1 for 2.0.0-rc.2 or 2.0.0),
 * becomes `## <version>`; an entry already named for it is left alone. Any
 * other newest entry is a released version, whose notes must not be renamed:
 * the new version's notes go under `## Unreleased` first.
 */

const HEADING = /^## \[?v?([^\]\s]+)\]?(.*)$/m;

const core = (version) => version.split('-')[0];

/** The changelog with its newest entry named for `version`; throws when it cannot be. */
export function changelogFor(text, version) {
    const match = HEADING.exec(text);
    if (!match) throw new Error('CHANGELOG.md has no "## " entry. Add the notes for this release under "## Unreleased".');
    const [line, name, rest] = match;
    if (name === version) return text;
    const unreleased = /^unreleased$/i.test(name);
    const earlierPrerelease = name.includes('-') && core(name) === core(version) && name !== version;
    if (!unreleased && !earlierPrerelease) {
        throw new Error(`CHANGELOG.md's newest entry is ${name}. Add the notes for ${version} under "## Unreleased" first.`);
    }
    return text.slice(0, match.index) + `## ${version}${unreleased ? '' : rest}` + text.slice(match.index + line.length);
}
