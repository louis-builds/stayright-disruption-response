using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TravelDisruptionAgent.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddCaseWorkflowStateHistory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "case_workflow_state_histories",
                columns: table => new
                {
                    id = table.Column<Guid>(type: "uuid", nullable: false),
                    case_id = table.Column<Guid>(type: "uuid", nullable: false),
                    state = table.Column<string>(type: "text", nullable: false),
                    started_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ended_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_case_workflow_state_histories", x => x.id);
                    table.ForeignKey(
                        name: "fk_case_workflow_state_histories_cases_case_id",
                        column: x => x.case_id,
                        principalTable: "cases",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_case_workflow_state_histories_case_id_started_at",
                table: "case_workflow_state_histories",
                columns: new[] { "case_id", "started_at" });

            migrationBuilder.CreateIndex(
                name: "ix_case_workflow_state_histories_state_started_at_ended_at",
                table: "case_workflow_state_histories",
                columns: new[] { "state", "started_at", "ended_at" });

            // Start an honest baseline at migration time. We do not pretend to
            // reconstruct state transitions that happened before history existed.
            migrationBuilder.Sql("""
                INSERT INTO case_workflow_state_histories (id, case_id, state, started_at, ended_at)
                SELECT gen_random_uuid(), c.id,
                    CASE
                        WHEN c.status = 'closed' THEN 'closed'
                        WHEN EXISTS (SELECT 1 FROM inquiries i WHERE i.case_id = c.id AND i.status = 'pending') THEN 'awaiting_hotel'
                        WHEN EXISTS (SELECT 1 FROM options o WHERE o.case_id = c.id AND o.availability <> 'pending') THEN 'awaiting_guest'
                        WHEN c.status = 'in_progress' THEN 'in_progress'
                        ELSE 'new'
                    END,
                    NOW(), NULL
                FROM cases c;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "case_workflow_state_histories");
        }
    }
}
