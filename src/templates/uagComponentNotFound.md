<% if (error === 'no_uag') { %>
There are no `uag` fields present within the provided form. In order to use the `agent_provide_data` tool, you must first flag certain fields as the **Criteria** and **Agent Fields**.
 - **Criteria**: A content component with properties `uag="<%= persona %>"` and `uagField="criteria"`. Within the content of this component, provide detailed instructions (criteria) for the agent to follow when analyzing the data.
 - **Agent Fields**: Any fields you wish the agent to populate with its own data, you must flag those fields with the property `uag="<%= persona %>"`. These fields will then be handed to the AI Agent as required fields for them to populate according to the provided **Criteria**.
<% } %>
<% if (error === 'no_criteria') { %>
No `criteria` field was found within this form with the properties `uag="<%= persona %>"` and `uagField="criteria"`. To add `criteria`, add a Content component to the form and then give it the following properties: `uag="<%= persona %>"` and `uagField="criteria"`. Within the content of this component, provide detailed instructions (the criteria) for the agent to follow when analyzing the data.
<% } %>
<% if (error === 'no_fields') { %>
There are no `uag` fields within this form under the provided `persona=<%= persona %>` that are available for the AI Agent to provide values for. To flag a field as fillable by the AI Agent, you must add the property and value `uag="<%= persona %>"`
<% } %>