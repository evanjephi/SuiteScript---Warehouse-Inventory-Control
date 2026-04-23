module.exports = {
    defaultProjectFolder: 'src',
    commands: {
        "project:deploy": {
            beforeExecuting: async (args) => {
                return args; 
            }
        }
    }
};
