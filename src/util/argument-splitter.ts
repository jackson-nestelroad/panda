/**
 * Type of group the argument is currently in.
 */
enum GroupType {
    New,
    None,
    DoubleQuote,
    CodeBacktick,
}

/**
 * A single split argument that can be consumed as oone argument by a command.
 */
export class SplitArgument {
    /**
     * The actual parsed content for the argument, however it was
     * grouped together by the original content.
     */
    public readonly content: string;

    private readonly type: GroupType;
    private readonly originalIndex: number;

    public constructor(content: string, type: GroupType, originalIndex: number) {
        this.content = content;
        this.type = type;
        this.originalIndex = originalIndex;
    }

    /**
     * Checks if the argument is a normal word, or not grouped in any way.
     * @returns Is the argument normal?
     */
    public isNormal(): boolean {
        return this.type === GroupType.None;
    }

    /**
     * Checks if the argument is quoted, or surrounded by double quotes.
     * @returns Is the argument quoted?
     */
    public isQuoted(): boolean {
        return this.type === GroupType.DoubleQuote;
    }

    /**
     * Checks if the argument is code, or surrounded by code backticks.
     * @returns Is the argument code?
     */
    public isCode(): boolean {
        return this.type === GroupType.CodeBacktick;
    }
}

/**
 * An error generated by the `ArgumentSplitter` class.
 */
export class ArgumentSplitterError extends Error {
    constructor(message: string) {
        super(`ArgumentSplitterError: ${message}`);
    }
}

/**
 * Provides an array-like interface to arguments split by `ArgumentSplitter`.
 * The primary feature of this class is the ability to restore the string the arguments
 * were parsed from using `restore(i)`.
 */
export class SplitArgumentArray {
    /**
     * The original string that was split into the arguments stored here.
     */
    public readonly original: string;

    /**
     * The actual arguments, along with their metadata, that were split and can
     * be used by commands.
     */
    public get args(): readonly SplitArgument[] {
        return this._args;
    }

    constructor(original: string, private _args: SplitArgument[]) {
        this.original = original;
    }

    /**
     * Number of arguments.
     */
    public get length(): number {
        return this.args.length;
    }

    /**
     * Gets the parsed argument at the given index.
     * @param i Index.
     * @returns Argument.
     */
    public get(i: number): string {
        return this.args[i]?.content;
    }

    /**
     * Restores the arguments into a string from the given index.
     * @param start Index to start from.
     * @param end Index (exclusive) to end the restored string.
     * @returns Content with all arguments from argument `i` to the end
     * of the string.
     */
    public restore(start: number, end?: number): string {
        return this.original.substring(this.args[start]?.['originalIndex'], this.args[end]?.['originalIndex']);
    }

    /**
     * Removes and returns the first argument.
     * @returns Removed argument.
     */
    public shift(): string {
        return this._args.shift()?.content;
    }

    /**
     * Returns a section of the arguments array.
     * @param start The beginning (inclusive) of the specified portion.
     * @param end The end (exclusive) of the specified portion. Default is end of the array.
     * @returns Specified section of array.
     */
    public slice(start?: number, end?: number): SplitArgumentArray {
        return new SplitArgumentArray(this.original, this.args.slice(start, end));
    }
}

/**
 * State machine that splits a string into an array of arguments.
 */
export class ArgumentSplitter {
    private escaped = false;
    private startOfCurrentGroup: number = 0;
    private group = GroupType.New;
    private next = '';
    private readonly backticks = {
        past: 0,
        present: 0,
    };

    private readonly args: SplitArgument[] = [];

    /**
     * The maximum number of backticks that can be used to form one group.
     */
    private readonly maxBackticksToFormAGroup = 3;

    /**
     * Pushes the next argument into the result array as a complete argument.
     *
     * Empty strings are only pushed if they are encapsulated in some group.
     */
    private pushArg(): void {
        if (this.next || (this.group !== GroupType.None && this.group !== GroupType.New)) {
            this.args.push(new SplitArgument(this.next, this.group, this.startOfCurrentGroup));
            this.next = '';
        }
        this.group = GroupType.New;
    }

    /**
     * Appends a character to the next argument.
     * @param char Next character.
     */
    private appendChar(char: string, i: number): void {
        if (this.group === GroupType.New && char !== '') {
            this.newGroup(GroupType.None, i);
        }
        this.next += char;
        this.escaped = false;
    }

    /**
     * Creates a new group in the argument group map and sets the group type.
     * @param type New group type.
     * @param i Index where new group starts.
     */
    private newGroup(type: GroupType, i: number): void {
        this.group = type;
        this.startOfCurrentGroup = i;
    }

    /**
     * Consumes a normal character without any backtick logic.
     * @param char Next character.
     * @param i Current index.
     */
    private consumeNormalChar(char: string, i: number): void {
        switch (char) {
            // Backslashes are used for escaping.
            case '\\':
                this.escaped = !this.escaped;
                if (!this.escaped) {
                    this.appendChar(char, i);
                }
                break;
            // Quotes can be used to group an argument together.
            case '"':
                if (this.group === GroupType.DoubleQuote) {
                    if (!this.escaped) {
                        // End of the current argument group.
                        this.pushArg();
                    } else {
                        // Quote is escaped, just a normal char.
                        this.appendChar(char, i);
                    }
                } else if (this.group === GroupType.New || this.group === GroupType.None) {
                    if (!this.escaped) {
                        // Start of a new argument group.
                        this.pushArg();
                        this.newGroup(GroupType.DoubleQuote, i);
                    } else {
                        // Quote is escaped, just a normal char.
                        this.appendChar(char, i);
                    }
                } else {
                    // In some other group, just a normal char.
                    this.appendChar(char, i);
                }
                break;
            // Whitespace is used to separate arguments when not in a group.
            case ' ':
            case '\f':
            case '\n':
            case '\r':
            case '\t':
            case '\v':
                if (this.group === GroupType.None || this.group === GroupType.New) {
                    // No group, so whitespace is the separator.
                    this.pushArg();
                } else {
                    // In a group, so whitespace is a normal char.
                    this.appendChar(char, i);
                }
                break;
            // Empty character signals the end.
            case '':
                if (this.group === GroupType.None) {
                    this.pushArg();
                }
                break;
            // Everything else, including backticks that made it here.
            default:
                this.appendChar(char, i);
                break;
        }
    }

    /**
     * Handles any extra backticks that are present in `this.backticks.present` by
     * forming any intermediate groups.
     * @param i Current index.
     */
    private handleExtraBackticks(i: number): void {
        // There is an arbitrary maxmimum number of backticks that can make up a group.
        // Anything after is either extra, or possibly the end of the group. In fact,
        // multiple groups can be created and ended by one string of backticks.
        //
        // For example: ```````` actually creates one complete group and starts another with
        // the remaining two backticks.
        const maxGroups = Math.floor(this.backticks.present / this.maxBackticksToFormAGroup);
        const leftOver = this.backticks.present % this.maxBackticksToFormAGroup;

        // Each max-pairing makes a complete group.
        const completeGroups = Math.floor(maxGroups / 2);
        const endsWithNewMaxGroup = maxGroups % 2 === 1;

        let lookbackIndex = i - this.backticks.present;
        // This string of backticks ends with a new, unmatched group when the number of max-groups
        // is odd, which means there is one max-group that is unmatched.
        //
        // When this is 0, this loop will never run and no extra arguments will be created.
        for (let j = 0; j < completeGroups; ++j, lookbackIndex += this.maxBackticksToFormAGroup * 2) {
            this.newGroup(GroupType.CodeBacktick, lookbackIndex);
            this.pushArg();
        }

        // Record how many backticks start the current group so we can match them in the end.
        // If not, the leftover backticks start the next group.
        this.backticks.past = endsWithNewMaxGroup ? this.maxBackticksToFormAGroup : leftOver;
        this.backticks.present = 0;

        if (endsWithNewMaxGroup) {
            // The leftover backticks are actual characters in the group if a new group was formed.
            this.newGroup(GroupType.CodeBacktick, lookbackIndex);
            this.appendChar('`'.repeat(leftOver), i);
        } else if (leftOver !== 0) {
            // The leftover backticks start the new group.
            this.newGroup(GroupType.CodeBacktick, lookbackIndex);
        }
    }

    /**
     * Consumes a character for parsing. Handles all backtick logic.
     * @param char Next character.
     * @param i Current index.
     */
    private consumeChar(char: string, i: number): void {
        // We handle backticks with additional logic because they can be grouped in
        // weird ways. Up to three backticks can be used at once to make a group.

        if (this.group === GroupType.DoubleQuote) {
            // A quote group treats backticks as normal characters.
            this.consumeNormalChar(char, i);
        } else if (char === '`' && !this.escaped) {
            // Next char is an unescaped backtick that starts or ends a group, so record it.
            ++this.backticks.present;
        } else if (this.backticks.present !== 0) {
            // Next char is not a backtick (it could be, but it's escaped),
            // so the current chain of backticks has finished.

            if (this.group === GroupType.None || this.group == GroupType.New) {
                // Start of a new group.
                // Notice that this.group is being set at the same time that this.backticks.past is nonzero.

                // Push whatever was existing before the new group.
                this.pushArg();
                // Set group after push.
                this.group = GroupType.CodeBacktick;
                this.handleExtraBackticks(i);

                if (this.group === GroupType.CodeBacktick) {
                    this.appendChar(char, i);
                } else {
                    this.consumeNormalChar(char, i);
                }
            } else if (this.group === GroupType.CodeBacktick) {
                // When the group is a code block, the number of past backticks must be set.
                if (this.backticks.past === 0) {
                    throw new ArgumentSplitterError('Parsing a code block, but unknown number of backticks to match.');
                }

                // Less backticks now then we need to match the group, so we append them as normal chars.
                if (this.backticks.present < this.backticks.past) {
                    this.appendChar('`'.repeat(this.backticks.present), i);
                } else {
                    // We surely have enough backticks to match the group, so count those off.
                    this.backticks.present -= this.backticks.past;
                    // Push whatever is in the group.
                    this.pushArg();
                    this.handleExtraBackticks(i);

                    if (this.group === GroupType.CodeBacktick) {
                        this.appendChar(char, i);
                    } else {
                        this.consumeNormalChar(char, i);
                    }
                }
            } else {
                throw new ArgumentSplitterError(
                    `Impossible condition: backticks are recorded but group is in unknown state \`${this.group}\``,
                );
            }
        } else {
            // No backticks are being recorded, so let's handle the char normally.
            this.consumeNormalChar(char, i);
        }
    }

    /**
     * Splits a string into an array of arguments that can be logically consumed
     * and used for command parsing.
     *
     * Arguments are separated by any number of whitespace by default. However, this
     * splitter also supports grouping arguments using quotations or code blocks (one
     * to three backticks). These characters can also be escaped using backslashes.
     * @param content Message content.
     * @returns Array of arguments.
     */
    public split(content: string): SplitArgumentArray {
        for (let i = 0; i < content.length; ++i) {
            this.consumeChar(content.charAt(i), i);
        }
        // Consume an empty character to finish parsing.
        this.consumeChar('', content.length);
        if (this.group !== GroupType.New) {
            throw new ArgumentSplitterError(`Unfinished group (type = ${this.group}).`);
        }
        return new SplitArgumentArray(content, this.args);
    }
}
