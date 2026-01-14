<template>
    <div class="flex-container flexFlowColumn">
        <div>
            <strong><slot name="title" /></strong>
        </div>
        <slot name="content" />
    </div>
</template>
