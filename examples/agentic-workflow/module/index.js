/**
 * UAG module for the agentic-workflow example.
 *
 * The only thing this module does is hand the UAG a Form.io project template.
 * On boot the UAG registers every form in that template, so the `application`
 * and `sum` forms — along with their criteria content, agent fields, and
 * webhook actions — exist without anyone clicking through the form builder.
 */
module.exports = {
    config: {
        template: require('./project.json'),
    },
};
