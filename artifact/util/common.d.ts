export declare function correctlyMerge<TObject, TSource>(lhs: TObject, rhs: TSource): TObject & TSource;
export declare function uuidv4(): string;
export declare function checkMinimumVersion(expected: string, title: string): Promise<void>;
export declare function literalYamlify(value: any): string;
export declare function parseString(content: string): any;
