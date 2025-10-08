declare module '*?raw' {
    const content: string;
    export default content;
}
declare module '*.html' {
    const content: string;
    export default content;
}
declare module '*.md' {
    const content: string;
    export default content;
}
declare module '*.css' {
    const content: unknown;
    export default content;
}

declare module '*.vue' {
    import type { DefineComponent } from 'vue';
    const component: DefineComponent<{}, {}, any>;
    export default component;
}

declare const YAML: typeof import('yaml');

declare const __BUILD_DATE__: string | undefined;
declare const __COMMIT_ID__: string | undefined;
