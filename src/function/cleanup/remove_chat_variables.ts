export async function removeChatVariables() {
    updateVariablesWith(
        variables => {
            _.unset(variables, 'initialized_lorebooks');
            _.unset(variables, 'stat_data');
            _.unset(variables, 'schema');
            _.unset(variables, 'display_data');
            _.unset(variables, 'delta_data');
            return variables;
        },
        { type: 'chat' }
    );
}
